package core

import (
	"os"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"golang.org/x/exp/slog"
)

var Logger *zap.Logger
var SlogLogger *slog.Logger

func InitializeLogger() {
	config := zap.NewDevelopmentEncoderConfig()
	config.EncodeTime = zapcore.ISO8601TimeEncoder
	fileEncode := zapcore.NewJSONEncoder(config)
	os.Mkdir("logs", 0755)
	logFile, err := os.OpenFile("logs/serverLogs.log", os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		panic(err)
	}
	writer := zapcore.AddSync(logFile)
	defaultLogLevel := zapcore.DebugLevel
	core := zapcore.NewTee(
		zapcore.NewCore(fileEncode, writer, defaultLogLevel),
	)
	Logger = zap.New(core, zap.AddCaller(), zap.AddStacktrace(zapcore.ErrorLevel))
}

func InitializeSlogLogger() {
	opts := &slog.HandlerOptions{
		AddSource: true,
		Level:     slog.LevelDebug,
	}
	authLogsFile, err := os.OpenFile("logs/authLogs.log", os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		panic(err)
	}
	var handler slog.Handler = slog.NewJSONHandler(authLogsFile, opts)
	SlogLogger = slog.New(handler)
}
