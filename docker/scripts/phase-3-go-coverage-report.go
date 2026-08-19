package main

import (
	"bufio"
	"encoding/json"
	"flag"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

type manifest struct {
	Modules []struct {
		Path   string   `json:"path"`
		Report string   `json:"report"`
		Scope  []string `json:"scope"`
	} `json:"modules"`
}

type block struct{ start, end, statements, count int }
type span struct{ start, end int }

func main() {
	root := flag.String("root", "", "repository root")
	profile := flag.String("profile", "", "Go cover profile")
	output := flag.String("output", "", "JSON output")
	flag.Parse()
	if *root == "" || *profile == "" || *output == "" {
		panic("root, profile, and output are required")
	}

	manifestBytes, err := os.ReadFile(filepath.Join(*root, "docs/runbooks/phase-3-coverage-manifest.json"))
	check(err)
	var mf manifest
	check(json.Unmarshal(manifestBytes, &mf))
	blocksByPath := readProfile(*profile)
	report := map[string]map[string]float64{}
	for _, entry := range mf.Modules {
		if entry.Report != "go" {
			continue
		}
		blocks := blocksByPath[entry.Path]
		if len(blocks) == 0 {
			panic("profile omitted " + entry.Path)
		}
		selected := blocks
		key := entry.Path
		if len(entry.Scope) > 0 {
			spans := functionSpans(filepath.Join(*root, entry.Path), entry.Scope)
			selected = nil
			for _, candidate := range blocks {
				for _, function := range spans {
					if candidate.start >= function.start && candidate.end <= function.end {
						selected = append(selected, candidate)
						break
					}
				}
			}
			key += "#" + strings.Join(entry.Scope, ",")
		}
		covered, total := 0, 0
		for _, candidate := range selected {
			total += candidate.statements
			if candidate.count > 0 {
				covered += candidate.statements
			}
		}
		if total == 0 {
			panic("no statements selected for " + key)
		}
		report[key] = map[string]float64{"statements": float64(covered) * 100 / float64(total)}
	}
	encoded, err := json.Marshal(report)
	check(err)
	temporary, err := os.CreateTemp(filepath.Dir(*output), filepath.Base(*output)+".*.tmp")
	check(err)
	temporaryName := temporary.Name()
	defer os.Remove(temporaryName)
	check(temporary.Chmod(0o600))
	_, err = temporary.Write(append(encoded, '\n'))
	check(err)
	check(temporary.Sync())
	check(temporary.Close())
	check(os.Rename(temporaryName, *output))
}

func readProfile(profile string) map[string][]block {
	file, err := os.Open(profile)
	check(err)
	defer file.Close()
	merged := map[string]map[string]block{}
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "mode:") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) != 3 {
			panic("invalid cover profile line: " + line)
		}
		colon := strings.LastIndex(fields[0], ":")
		if colon < 0 {
			panic("invalid cover location")
		}
		fileName, location := fields[0][:colon], fields[0][colon+1:]
		fileName = strings.TrimPrefix(fileName, "github.com/durgakiran/beskar/")
		parts := strings.FieldsFunc(location, func(r rune) bool { return r == '.' || r == ',' })
		if len(parts) != 4 {
			panic("invalid cover range")
		}
		start, _ := strconv.Atoi(parts[0])
		end, _ := strconv.Atoi(parts[2])
		statements, _ := strconv.Atoi(fields[1])
		count, _ := strconv.Atoi(fields[2])
		pathKey := "server/" + fileName
		if merged[pathKey] == nil {
			merged[pathKey] = map[string]block{}
		}
		locationKey := fmt.Sprintf("%d:%d:%d", start, end, statements)
		candidate := block{start, end, statements, count}
		if existing, ok := merged[pathKey][locationKey]; !ok || candidate.count > existing.count {
			merged[pathKey][locationKey] = candidate
		}
	}
	check(scanner.Err())
	result := map[string][]block{}
	for pathKey, blocks := range merged {
		for _, candidate := range blocks {
			result[pathKey] = append(result[pathKey], candidate)
		}
	}
	return result
}

func functionSpans(fileName string, required []string) []span {
	set := token.NewFileSet()
	parsed, err := parser.ParseFile(set, fileName, nil, 0)
	check(err)
	found := map[string]span{}
	ast.Inspect(parsed, func(node ast.Node) bool {
		declaration, ok := node.(*ast.FuncDecl)
		if !ok {
			return true
		}
		found[declaration.Name.Name] = span{set.Position(declaration.Pos()).Line, set.Position(declaration.End()).Line}
		return false
	})
	missing := []string{}
	spans := []span{}
	for _, name := range required {
		if value, ok := found[name]; ok {
			spans = append(spans, value)
		} else {
			missing = append(missing, name)
		}
	}
	if len(missing) > 0 {
		sort.Strings(missing)
		panic(fmt.Sprintf("missing scoped functions in %s: %s", fileName, strings.Join(missing, ", ")))
	}
	return spans
}

func check(err error) {
	if err != nil {
		panic(err)
	}
}
