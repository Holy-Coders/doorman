package main

import (
	doorman "github.com/Holy-Coders/doorman/packages/go"
	"log"
	"net/http"
	"os"
	"time"
)

func main() {
	client, err := doorman.NewClient(os.Getenv("DOORMAN_ENDPOINT"), doorman.Options{BearerToken: os.Getenv("DOORMAN_GATEWAY_TOKEN")})
	if err != nil {
		log.Fatal(err)
	}
	mux := http.NewServeMux()
	mux.Handle("/api/visitor", client.Handler())
	server := &http.Server{Addr: "127.0.0.1:3001", Handler: mux, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 10 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 16384}
	log.Fatal(server.ListenAndServe())
}
