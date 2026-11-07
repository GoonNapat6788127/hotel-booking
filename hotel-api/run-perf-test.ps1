$BaseUrl = "http://localhost:3000"
$Body = @{ email = "testuser@example.com"; password = "Test1234" } | ConvertTo-Json

Write-Host "--- Performance Test with Autocannon ---"
Write-Host "1. Getting Auth Token..."
$Token = (Invoke-RestMethod -Method Post -Uri "$BaseUrl/auth/login" `
  -ContentType "application/json" -Body $Body).access_token

if (-not $Token -or $Token.Length -lt 10) { Write-Host "Login Failed. Token empty."; exit 1 }
Write-Host "Token acquired."

docker exec hotel_redis redis-cli flushall | Out-Null

Write-Host "`n2. Running Autocannon (10s duration)..."
npx autocannon -c 100 -d 10 --renderStatusCodes -H "Authorization: Bearer $Token" "$BaseUrl/rooms"

Write-Host "`n3. Redis keys after the test:"
docker exec hotel_redis redis-cli keys "rooms:*"