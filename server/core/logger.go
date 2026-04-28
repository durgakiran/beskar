package core

import (
	"io"
	"os"
	"strconv"
	"strings"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"golang.org/x/exp/slog"
)

var Logger = zap.NewNop()
var SlogLogger = slog.New(slog.NewTextHandler(io.Discard, nil))

func logsToFiles() bool {
	value := strings.TrimSpace(os.Getenv("LOG_TO_FILES"))
	if value == "" {
		return true
	}
	enabled, err := strconv.ParseBool(value)
	if err != nil {
		return true
	}
	return enabled
}

func zapLogLevel() zapcore.Level {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("LOG_LEVEL"))) {
	case "error":
		return zapcore.ErrorLevel
	case "warn", "warning":
		return zapcore.WarnLevel
	case "info":
		return zapcore.InfoLevel
	case "debug", "":
		return zapcore.DebugLevel
	default:
		return zapcore.DebugLevel
	}
}

func slogLogLevel() slog.Level {
	switch zapLogLevel() {
	case zapcore.ErrorLevel:
		return slog.LevelError
	case zapcore.WarnLevel:
		return slog.LevelWarn
	case zapcore.InfoLevel:
		return slog.LevelInfo
	default:
		return slog.LevelDebug
	}
}

func InitializeLogger() {
	config := zap.NewDevelopmentEncoderConfig()
	config.EncodeTime = zapcore.ISO8601TimeEncoder
	fileEncode := zapcore.NewJSONEncoder(config)
	var writer zapcore.WriteSyncer
	if logsToFiles() {
		os.Mkdir("logs", 0755)
		logFile, err := os.OpenFile("logs/serverLogs.log", os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
		if err != nil {
			panic(err)
		}
		writer = zapcore.AddSync(logFile)
	} else {
		writer = zapcore.AddSync(os.Stderr)
	}
	core := zapcore.NewTee(
		zapcore.NewCore(fileEncode, writer, zapLogLevel()),
	)
	Logger = zap.New(core, zap.AddCaller(), zap.AddStacktrace(zapcore.ErrorLevel))
}

func InitializeSlogLogger() {
	opts := &slog.HandlerOptions{
		AddSource: true,
		Level:     slogLogLevel(),
	}
	var destination io.Writer = os.Stderr
	if logsToFiles() {
		authLogsFile, err := os.OpenFile("logs/authLogs.log", os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
		if err != nil {
			panic(err)
		}
		destination = authLogsFile
	}
	var handler slog.Handler = slog.NewJSONHandler(destination, opts)
	SlogLogger = slog.New(handler)
}
