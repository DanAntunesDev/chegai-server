#!/bin/sh
set -e

endpoint=http://minio:9000
bucket=chegai

until aws --endpoint-url "$endpoint" s3api list-buckets >/dev/null 2>&1; do
  sleep 1
done

aws --endpoint-url "$endpoint" s3api head-bucket --bucket "$bucket" 2>/dev/null ||
  aws --endpoint-url "$endpoint" s3api create-bucket --bucket "$bucket"

aws --endpoint-url "$endpoint" s3api put-bucket-policy --bucket "$bucket" --policy '{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "AWS": ["*"] },
    "Action": ["s3:GetObject"],
    "Resource": ["arn:aws:s3:::chegai/tenants/*"]
  }]
}'
