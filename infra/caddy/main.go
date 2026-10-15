// Copyright 2015 Matthew Holt and The Caddy Authors
// Licensed under the Apache License, Version 2.0.
// https://www.apache.org/licenses/LICENSE-2.0
// Standard Caddy entry point; dependencies patched for this distribution.
package main

import (
    _ "time/tzdata"
    caddycmd "github.com/caddyserver/caddy/v2/cmd"
    _ "github.com/caddyserver/caddy/v2/modules/standard"
)

func main() { caddycmd.Main() }
