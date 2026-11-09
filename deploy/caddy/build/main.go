// Caddy built from source (F9, ADR-0090): the official image's binary carries dependencies with
// known fixes, so the edge image compiles this module with them raised in go.mod.
package main

import (
	caddycmd "github.com/caddyserver/caddy/v2/cmd"

	// Standard modules, the same set as the official build.
	_ "github.com/caddyserver/caddy/v2/modules/standard"
)

func main() {
	caddycmd.Main()
}
