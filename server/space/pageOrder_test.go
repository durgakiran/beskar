package space

import (
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestPageSortKeyBetween(t *testing.T) {
	for _, test := range []struct{ lower, upper string }{
		{"", ""}, {"", "a0"}, {"a0", ""}, {"a0", "a1"}, {"a0V", "a1"}, {"Zz", "a0"}, {"az", "b00"},
	} {
		key, err := pageSortKeyBetween(test.lower, test.upper)
		if err != nil {
			t.Fatal(err)
		}
		if test.lower != "" && key <= test.lower || test.upper != "" && key >= test.upper {
			t.Fatalf("%q is not between %q and %q", key, test.lower, test.upper)
		}
		if strings.Trim(key, "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz") != "" {
			t.Fatalf("not Base62: %q", key)
		}
	}
	if _, err := pageSortKeyBetween("a1", "a0"); err == nil {
		t.Fatal("reversed bounds accepted")
	}
}

func TestPageSortKeyRepeatedInsertion(t *testing.T) {
	lower, upper := "a0", "a1"
	for range 500 {
		key, err := pageSortKeyBetween(lower, upper)
		if err != nil || key <= lower || key >= upper {
			t.Fatalf("key=%q err=%v", key, err)
		}
		upper = key
	}
	if _, err := pageSortKeyBetween("a0", "a0"+strings.Repeat("0", 255)+"1"); !errors.Is(err, errPageRankExhausted) {
		t.Fatalf("expected rank length limit, got %v", err)
	}
}

func TestPageChangeConflicts(t *testing.T) {
	for _, code := range []string{"40001", "40P01", "55P03", "23505"} {
		err := fmt.Errorf("database operation: %w", &pgconn.PgError{Code: code, ConstraintName: "page_sibling_sort_key_unique"})
		if !errors.Is(pageChangeError(err), errPageChangeConflict) {
			t.Fatalf("%s must be a conflict", code)
		}
	}
	if pageChangeError(nil) != nil {
		t.Fatal("success became error")
	}
	if !errors.Is(pageChangeError(errMovePageCycle), errMovePageCycle) {
		t.Fatal("cycle validation changed")
	}
}
