// documentbodytext generates JSONL search documents without writing to PostgreSQL.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/durgakiran/beskar/searchtext"
	"github.com/jackc/pgx/v5"
)

func main() {
	if err := run(os.Args[1:], os.Stdout, os.Stderr); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(args []string, stdout, stderr io.Writer) error {
	flags := flag.NewFlagSet("documentbodytext", flag.ContinueOnError)
	flags.SetOutput(stderr)
	inputPath := flags.String("input", "", "JSONL published-node export; - reads stdin (otherwise use DATABASE_URL)")
	outputPath := flags.String("output", "", "new private JSONL output file; defaults to stdout")
	pageID := flags.Int64("page-id", 0, "one page ID; zero selects all eligible publications")
	exportSQL := flags.Bool("export-sql", false, "print a read-only psql export script instead of generating documents")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() != 0 {
		return fmt.Errorf("unexpected positional arguments")
	}
	if *pageID < 0 {
		return fmt.Errorf("page-id must be nonnegative")
	}
	var output io.Writer = stdout
	if *outputPath != "" {
		f, err := os.OpenFile(*outputPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err != nil {
			return err
		}
		defer f.Close()
		output = f
	}
	if *exportSQL {
		_, err := fmt.Fprintf(output, "BEGIN READ ONLY;\nSET LOCAL TIME ZONE 'UTC';\n%s;\nCOMMIT;\n", strings.ReplaceAll(searchtext.PublishedQuery, "$1", fmt.Sprint(*pageID)))
		return err
	}
	encoder := json.NewEncoder(output)
	passed, failed := 0, 0
	visit := func(input searchtext.PublishedNodes) error {
		if *pageID != 0 && input.PageID != *pageID {
			return nil
		}
		document, err := input.Generate()
		if err != nil {
			failed++
			fmt.Fprintf(stderr, "page=%d doc=%d: %v\n", input.PageID, input.DocID, err)
			return nil
		}
		if err := encoder.Encode(document); err != nil {
			return err
		}
		passed++
		return nil
	}
	if *inputPath != "" {
		var input io.Reader = os.Stdin
		if *inputPath != "-" {
			f, err := os.Open(*inputPath)
			if err != nil {
				return err
			}
			defer f.Close()
			input = f
		}
		decoder := json.NewDecoder(input)
		for {
			var raw json.RawMessage
			err := decoder.Decode(&raw)
			if err == io.EOF {
				break
			}
			if err != nil {
				return fmt.Errorf("decode JSONL input: %w", err)
			}
			nodes, err := searchtext.DecodePublished(raw)
			if err != nil {
				return err
			}
			if err := visit(nodes); err != nil {
				return err
			}
		}
	} else {
		url := os.Getenv("DATABASE_URL")
		if url == "" {
			return fmt.Errorf("set DATABASE_URL or supply --input")
		}
		ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
		defer cancel()
		ctx, timeout := context.WithTimeout(ctx, 5*time.Minute)
		defer timeout()
		conn, err := pgx.Connect(ctx, url)
		if err != nil {
			return fmt.Errorf("connect to source database failed (check DATABASE_URL)")
		}
		defer conn.Close(context.Background())
		tx, err := conn.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
		if err != nil {
			return err
		}
		defer tx.Rollback(context.Background())
		if err := searchtext.ReadPublished(ctx, tx, *pageID, visit); err != nil {
			return err
		}
		if err := tx.Commit(ctx); err != nil {
			return err
		}
	}
	fmt.Fprintf(stderr, "Generated %d documents; %d failed.\n", passed, failed)
	if failed > 0 {
		return fmt.Errorf("generation incomplete: inspect failed publications; successful output is partial")
	}
	if passed == 0 {
		return fmt.Errorf("no matching published documents")
	}
	return nil
}
