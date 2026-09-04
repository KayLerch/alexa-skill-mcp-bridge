# S3: tunnel idle behavior

Checks whether a cloudflared quick tunnel keeps the `tools/call` stream open while the client waits 30 s and then 90 s before answering an elicitation, with and without the server's 15 s keepalive ping.

```bash
npm install                      # also needs ../strands-elicitation installed
brew install cloudflared
node spike.ts --port 3100 --url https://placeholder --help   # options
# terminal 1
cloudflared tunnel --url http://localhost:3100
# terminal 2
node spike.ts --url https://<random>.trycloudflare.com/mcp --gaps 30,90
node spike.ts --url https://<random>.trycloudflare.com/mcp --gaps 30,90 --no-ping
```

Creates nothing in AWS. The quick tunnel is free and disappears when cloudflared exits.
