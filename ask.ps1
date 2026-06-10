$token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6InYyIn0.eyJ0IjoidCIsInYiOiIyIiwidG9rZW5fdWlkIjoiNTg3MDJjY2QtYjRkOS00MjlmLWJmYjItYzcyNmJkOGVkNGU1IiwidXUiOiJSUDR1L0pHVVFnQ2xzVmpPZEo1ak1nPT0iLCJzdSI6Im43dUpiYzVoVG11UHVUM2R5QTdGbkE9PSIsImFpIjoiUlA0dS9KR1VRZ0Nsc1ZqT2RKNWpNZz09IiwiZnVsbF9hY2Nlc3MiOnRydWUsImlhdCI6MTc4MTEwMTQyNX0.kJDVXfZELU4ivJzkqkr5-3mr6YNI4bT_ro7OrNRjjoc"
$question = if ($args[0]) { $args -join " " } else { Read-Host "Ask AI" }
$body = @{interface="puter-chat-completion"; driver="ai-chat"; method="complete"; args=@{messages=@(@{role="user"; content=$question})}} | ConvertTo-Json -Compress
$response = curl.exe -s -X POST "https://api.puter.com/drivers/call" -H "Authorization: Bearer $token" -H "Content-Type: text/plain;actually=json" -d $body | ConvertFrom-Json
$response.result.message.content
