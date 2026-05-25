# deploy.ps1
# Automated backend deployment to AWS ECR and Lambda

# Load AWS credentials from root .env
$envFile = "../.env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^([^=]+)="?([^"]*)"?$') {
            $key = $Matches[1].Trim()
            $val = $Matches[2].Trim()
            if ($key -eq "ACCESS_KEY") { $env:AWS_ACCESS_KEY_ID = $val }
            elseif ($key -eq "SECRET_KEY") { $env:AWS_SECRET_ACCESS_KEY = $val }
            elseif ($key -eq "DEFAULT_REGION_NAME") { $env:AWS_DEFAULT_REGION = $val }
        }
    }
}

$region = $env:AWS_DEFAULT_REGION
if (-not $region) { $region = "eu-north-1" }
$registry = "509713237087.dkr.ecr.$region.amazonaws.com"
$repoName = "quill-backend"
$imageUri = "$registry/${repoName}:latest"
$lambdaName = "quill-backend-lambda"

Write-Host "1. Logging into AWS ECR..." -ForegroundColor Cyan
aws ecr get-login-password --region $region | docker login --username AWS --password-stdin $registry

Write-Host "2. Building Docker image..." -ForegroundColor Cyan
docker build --provenance=false -t $repoName .

Write-Host "3. Tagging Docker image..." -ForegroundColor Cyan
docker tag ${repoName}:latest $imageUri

Write-Host "4. Pushing Docker image to ECR..." -ForegroundColor Cyan
docker push $imageUri

Write-Host "5. Updating Lambda function code..." -ForegroundColor Cyan
aws lambda update-function-code --function-name $lambdaName --image-uri $imageUri --region $region
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Lambda update failed. Deployment aborted." -ForegroundColor Red
    exit 1
}

Write-Host "Deployment completed successfully!" -ForegroundColor Green
