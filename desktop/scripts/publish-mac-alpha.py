#!/usr/bin/env python3
"""Publish verified macOS alpha build outputs to an existing Cloudflare R2 bucket."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
from urllib.parse import urlsplit


IMMUTABLE = "public, max-age=31536000, immutable"
CHANNEL_KEY = "channels/alpha.json"


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_package(directory):
    info = dict(line.split("=", 1) for line in (directory / "build-info.txt").read_text().splitlines())
    version = info["version"]
    architecture = info["architecture"]
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+-alpha\.[0-9]+", version) or architecture not in {"arm64", "amd64"}:
        raise ValueError(f"Invalid alpha version or architecture in {directory}")
    if info["signing"] != "ad-hoc" or info["notarized"] != "false":
        raise ValueError(f"Expected an ad-hoc signed alpha build in {directory}")
    if not re.fullmatch(r"[1-9][0-9]*", info["build"]) or not re.fullmatch(r"[0-9a-f]{40}", info["source_revision"]):
        raise ValueError(f"Invalid build number or source revision in {directory}")
    if info["source_state"] not in {"clean", "dirty"} or not re.fullmatch(r"[0-9]+\.[0-9]+(?:\.[0-9]+)?", info["minimum_macos"]):
        raise ValueError(f"Invalid source state or macOS version in {directory}")
    name = f"Teddox-{version}-macos-{architecture}.dmg"
    dmg = directory / name
    digest = sha256(dmg)
    if (directory / "SHA256SUMS").read_text().split() != [digest, name]:
        raise ValueError(f"SHA-256 verification failed for {dmg}")
    return info, dmg, digest


class R2Error(RuntimeError):
    def __init__(self, operation, stderr):
        match = re.search(r"An error occurred \(([A-Za-z0-9]+)\)", stderr)
        self.code = match[1] if match else "CLI error"
        super().__init__(f"R2 {operation} failed ({self.code}). Check the AWS profile, bucket and permissions.")


def publish(args, release, uploads, manifest_path, work):
    env = dict(os.environ, AWS_REQUEST_CHECKSUM_CALCULATION="WHEN_REQUIRED",
               AWS_RESPONSE_CHECKSUM_VALIDATION="WHEN_REQUIRED")
    cli = ["aws", "--no-cli-pager", "--region", "auto", "--output", "json",
           "--endpoint-url", f"https://{args.account_id}.r2.cloudflarestorage.com", "s3api"]

    def request(operation, key, *options):
        result = subprocess.run(
            [*cli, operation, "--bucket", args.bucket, "--key", key, *options],
            env=env, capture_output=True, text=True, check=False,
        )
        if result.returncode:
            raise R2Error(operation, result.stderr)
        return json.loads(result.stdout or "{}")

    try:
        previous = request("head-object", CHANNEL_KEY)
        condition = ["--if-match", previous["ETag"]]
    except R2Error as error:
        if error.code not in {"404", "NotFound", "NoSuchKey"}:
            raise
        condition = ["--if-none-match", "*"]

    for key, path, content_type, digest in uploads:
        headers = ["--content-type", content_type, "--cache-control", IMMUTABLE]
        if path.suffix == ".dmg":
            headers.extend(["--content-disposition", f'attachment; filename="{path.name}"'])
        try:
            request("put-object", key, "--body", str(path), "--if-none-match", "*", *headers)
        except R2Error as error:
            if error.code not in {"412", "PreconditionFailed"}:
                raise
        downloaded = work / "readback"
        request("get-object", key, str(downloaded))
        if sha256(downloaded) != digest:
            raise ValueError(f"R2 object differs from the local release file: {key}")
        downloaded.unlink()
        if args.download_base_url:
            url = f"{args.download_base_url}/{key}"
            result = subprocess.run(
                ["curl", "--disable", "--fail", "--silent", "--show-error", "--max-time", "180",
                 "--output", str(downloaded), url], check=False,
            )
            if result.returncode or sha256(downloaded) != digest:
                raise ValueError(f"Public download verification failed for {url}")
            downloaded.unlink()
        print(f"Verified {key}", flush=True)

    manifest_key = uploads[-1][0]
    channel = {"version": release["version"], "release_key": manifest_key,
               "sha256": sha256(manifest_path)}
    if args.download_base_url:
        channel["release_url"] = f"{args.download_base_url}/{manifest_key}"
    pointer = work / "alpha.json"
    pointer.write_text(json.dumps(channel, indent=2) + "\n")
    request("put-object", CHANNEL_KEY, "--body", str(pointer), "--content-type", "application/json",
            "--cache-control", "no-store", *condition)
    print(f"Published {release['version']} to {args.bucket}/{CHANNEL_KEY}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("package_dirs", nargs="+", type=Path, help="Directories containing a DMG, SHA256SUMS and build-info.txt")
    parser.add_argument("--account-id", default=os.environ.get("R2_ACCOUNT_ID", ""))
    parser.add_argument("--bucket", default=os.environ.get("R2_BUCKET", ""))
    parser.add_argument("--download-base-url", default=os.environ.get("R2_DOWNLOAD_BASE_URL", ""),
                        help="Optional public HTTPS origin to verify downloads before publishing")
    parser.add_argument("--dry-run", action="store_true", help="Verify local files and print the upload plan without contacting R2")
    args = parser.parse_args()
    if not args.dry_run and not re.fullmatch(r"[0-9a-fA-F]{32}", args.account_id):
        parser.error("set R2_ACCOUNT_ID or --account-id to your Cloudflare account ID")
    if (args.bucket or not args.dry_run) and not re.fullmatch(r"[a-z0-9][a-z0-9-]{1,61}[a-z0-9]", args.bucket):
        parser.error("set R2_BUCKET or --bucket to your existing R2 bucket name")
    args.download_base_url = args.download_base_url.rstrip("/")
    if args.download_base_url:
        url = urlsplit(args.download_base_url)
        if url.scheme != "https" or not re.fullmatch(r"[a-zA-Z0-9.-]+", url.netloc) or url.path or url.query or url.fragment:
            parser.error("--download-base-url must be an HTTPS origin without a path")

    packages = sorted((read_package(path) for path in args.package_dirs), key=lambda package: package[0]["architecture"])
    fields = ("version", "build", "minimum_macos", "source_revision", "source_state", "signing", "notarized")
    first_info = packages[0][0]
    release = {field: first_info[field] for field in fields}
    release["channel"] = "alpha"
    release["packages"] = []
    prefix = f"releases/{release['version']}"
    uploads = []
    checksums = []
    architectures = set()
    for info, path, digest in packages:
        if any(info[field] != first_info[field] for field in (*fields, "api_origin", "issuer_origin", "client_id")):
            raise ValueError("All package directories must belong to the same release and build configuration")
        architecture = info["architecture"]
        if architecture in architectures:
            raise ValueError(f"Duplicate package architecture: {architecture}")
        architectures.add(architecture)
        key = f"{prefix}/macos/{path.name}"
        artifact = {"architecture": architecture, "key": key, "size_bytes": path.stat().st_size, "sha256": digest}
        if args.download_base_url:
            artifact["url"] = f"{args.download_base_url}/{key}"
        release["packages"].append(artifact)
        uploads.append((key, path, "application/x-apple-diskimage", digest))
        checksums.append(f"{digest}  macos/{path.name}\n")

    with tempfile.TemporaryDirectory(prefix="teddox-alpha-publish-") as temporary:
        work = Path(temporary)
        sums = work / "SHA256SUMS"
        sums.write_text("".join(checksums))
        manifest = work / "release.json"
        release["checksums_key"] = f"{prefix}/SHA256SUMS"
        manifest.write_text(json.dumps(release, indent=2) + "\n")
        uploads.extend([(release["checksums_key"], sums, "text/plain", sha256(sums)),
                        (f"{prefix}/release.json", manifest, "application/json", sha256(manifest))])
        if args.dry_run:
            print(json.dumps(release, indent=2))
            for key, _, _, _ in uploads:
                print(f"Would upload and verify {key}")
            print(f"Would update {CHANNEL_KEY} after verification")
        else:
            publish(args, release, uploads, manifest, work)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, R2Error) as error:
        raise SystemExit(f"Alpha publication failed: {error}") from None
