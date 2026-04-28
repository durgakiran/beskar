package storage

import (
	"context"
	"errors"
	"io"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/smithy-go"
)

// S3Store is the runtime implementation backed by an S3-compatible bucket.
type S3Store struct {
	client *s3.Client
	bucket string
	prefix string
}

func NewS3Store(ctx context.Context, cfg Config) (*S3Store, error) {
	if err := cfg.Validate(); err != nil {
		return nil, err
	}

	awsCfg, err := awsconfig.LoadDefaultConfig(
		ctx,
		awsconfig.WithRegion(cfg.Region),
		awsconfig.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(cfg.AccessKeyID, cfg.SecretAccessKey, "")),
	)
	if err != nil {
		return nil, err
	}

	client := s3.NewFromConfig(awsCfg, func(o *s3.Options) {
		o.BaseEndpoint = aws.String(cfg.Endpoint)
		// S3-compatible providers are most predictable in path-style mode when a custom endpoint is used.
		o.UsePathStyle = true
	})

	return &S3Store{
		client: client,
		bucket: cfg.Bucket,
		prefix: cfg.Prefix,
	}, nil
}

func (s *S3Store) Put(ctx context.Context, key string, body io.Reader, size int64, contentType string) error {
	input := &s3.PutObjectInput{
		Bucket:      aws.String(s.bucket),
		Key:         aws.String(s.objectKey(key)),
		Body:        body,
		ContentType: aws.String(contentType),
	}
	if size >= 0 {
		input.ContentLength = aws.Int64(size)
	}

	_, err := s.client.PutObject(ctx, input)
	return err
}

func (s *S3Store) Get(ctx context.Context, key string) (io.ReadCloser, BlobMetadata, error) {
	out, err := s.client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(s.objectKey(key)),
	})
	if err != nil {
		return nil, BlobMetadata{}, err
	}

	return out.Body, BlobMetadata{
		Size:        aws.ToInt64(out.ContentLength),
		ContentType: aws.ToString(out.ContentType),
	}, nil
}

func (s *S3Store) Exists(ctx context.Context, key string) (bool, error) {
	_, err := s.client.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(s.objectKey(key)),
	})
	if err == nil {
		return true, nil
	}

	var apiErr smithy.APIError
	if errors.As(err, &apiErr) {
		switch apiErr.ErrorCode() {
		case "NotFound", "NoSuchKey", "404":
			return false, nil
		}
	}

	return false, err
}

func (s *S3Store) Delete(ctx context.Context, key string) error {
	_, err := s.client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(s.objectKey(key)),
	})
	return err
}

func (s *S3Store) objectKey(key string) string {
	if s.prefix == "" {
		return key
	}
	return s.prefix + "/" + key
}
