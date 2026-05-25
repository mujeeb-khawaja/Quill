import os
import hashlib
import boto3
from botocore.exceptions import ClientError
from dotenv import load_dotenv
from datetime import datetime, timezone
from boto3.dynamodb.conditions import Key

load_dotenv()
load_dotenv('../.env')

aws_access_key = os.getenv("AWS_ACCESS_KEY_ID") or os.getenv("ACCESS_KEY")
aws_secret_key = os.getenv("AWS_SECRET_ACCESS_KEY") or os.getenv("SECRET_KEY")
region = os.getenv("AWS_DEFAULT_REGION") or os.getenv("DEFAULT_REGION_NAME") or "eu-north-1"

print(f"Connecting to DynamoDB (region: {region})...")
if aws_access_key and aws_secret_key:
    dynamodb = boto3.resource(
        'dynamodb',
        aws_access_key_id=aws_access_key,
        aws_secret_access_key=aws_secret_key,
        region_name=region
    )
    dynamodb_client = boto3.client(
        'dynamodb',
        aws_access_key_id=aws_access_key,
        aws_secret_access_key=aws_secret_key,
        region_name=region
    )
else:
    dynamodb = boto3.resource('dynamodb', region_name=region)
    dynamodb_client = boto3.client('dynamodb', region_name=region)

history_table = dynamodb.Table('Quill_History')


def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode('utf-8')).hexdigest()


def ensure_analytics_table():
    """Create Quill_Analytics table if it does not exist."""
    table_name = 'Quill_Analytics'
    try:
        dynamodb_client.describe_table(TableName=table_name)
        print(f"Table '{table_name}' already exists.")
    except ClientError as e:
        if e.response['Error']['Code'] == 'ResourceNotFoundException':
            print(f"Creating table '{table_name}'...")
            dynamodb.create_table(
                TableName=table_name,
                KeySchema=[
                    {'AttributeName': 'event_type', 'KeyType': 'HASH'},
                    {'AttributeName': 'sk',          'KeyType': 'RANGE'},
                ],
                AttributeDefinitions=[
                    {'AttributeName': 'event_type', 'AttributeType': 'S'},
                    {'AttributeName': 'sk',          'AttributeType': 'S'},
                ],
                BillingMode='PAY_PER_REQUEST',
            )
            # Wait until active
            waiter = dynamodb_client.get_waiter('table_exists')
            waiter.wait(TableName=table_name)
            print(f"Table '{table_name}' created successfully.")
        else:
            raise


def seed_admin():
    """Seed admin credentials into Quill_History if they don't exist."""
    username = 'admin'
    password = 'adminpassword123'
    hashed = hash_password(password)
    pk = f"ADMIN#{username}"

    print(f"Checking if admin user exists in Quill_History...")
    response = history_table.query(
        KeyConditionExpression=Key('user_id').eq(pk)
    )

    items = response.get('Items', [])
    if items:
        print("Admin user already exists in Quill_History.")
    else:
        print("Admin user not found. Seeding admin user...")
        history_table.put_item(Item={
            'user_id': pk,
            'timestamp': 'CREDENTIAL',
            'password_hash': hashed,
            'created_at': datetime.now(timezone.utc).isoformat()
        })
        print("Admin seeded successfully!")

    print("\n=======================================================")
    print("Admin Credentials:")
    print(f"  Username : {username}")
    print(f"  Password : {password}")
    print(f"  Table    : Quill_History")
    print(f"  PK       : {pk}")
    print(f"  SK       : CREDENTIAL")
    print("=======================================================\n")


if __name__ == '__main__':
    ensure_analytics_table()
    seed_admin()
