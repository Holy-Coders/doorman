package main

import (
	janitor "github.com/Holy-Coders/janitor/packages/go"
	"log"
	"net/http"
	"os"
	"time"
)

func main() {
	client, err := janitor.NewClient(os.Getenv("JANITOR_ENDPOINT"), janitor.Options{BearerToken: os.Getenv("JANITOR_GATEWAY_TOKEN")})
	if err != nil {
		log.Fatal(err)
	}
	mux := http.NewServeMux()
	mux.Handle("/api/visitor", client.Handler())
	server := &http.Server{Addr: "127.0.0.1:3001", Handler: mux, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 10 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 16384}
	log.Fatal(server.ListenAndServe())
}
