# Use the official AWS Lambda Python base image
FROM public.ecr.aws/lambda/python:3.11

WORKDIR ${LAMBDA_TASK_ROOT}

# Install building essentials
RUN yum update -y && \
    yum install -y git gcc gcc-c++ binutils-devel && \
    yum clean all

RUN pip install --upgrade pip setuptools wheel

# STAGE 1: Web (Confirmed Working)
RUN pip install --no-cache-dir fastapi mangum uvicorn python-multipart

# STAGE 2: Data (Confirmed Working)
RUN pip install --no-cache-dir pydantic pydantic-settings aiohttp requests PyJWT

# STAGE 3: AI Logic (THE CULPRIT - Forcing Binary Only)
# This prevents the linker crash by forbidding source compilation
RUN pip install --no-cache-dir --only-binary :all: \
    langgraph \
    langchain \
    langchain-community \
    langsmith

# STAGE 4: Providers (Safe as Binaries)
RUN pip install --no-cache-dir --only-binary :all: \
    langchain-groq \
    langchain-google-genai \
    qdrant-client \
    langchain-qdrant \
    pdfplumber \
    python-dotenv

COPY . .
CMD ["src.main.handler"]
