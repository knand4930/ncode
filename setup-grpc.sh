#!/bin/bash
# NCode AI Service - Quick Start Setup
# This script sets up the complete gRPC architecture

set -e

echo "======================================================================"
echo "  NCode AI Service - gRPC Setup"
echo "======================================================================"
echo ""

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check Python
if ! command -v python3 &> /dev/null; then
    echo -e "${YELLOW}⚠️  Python 3 not found. Please install Python 3.8+${NC}"
    exit 1
fi

PYTHON=$(command -v python3 || command -v python)
echo -e "${BLUE}✓ Python: $($PYTHON --version)${NC}"

# Step 1: Install Python dependencies
echo ""
echo -e "${BLUE}Step 1: Installing Python dependencies...${NC}"
cd python-ai-service

PYTHON_CMD="$PYTHON"
if ! $PYTHON_CMD -m pip --version > /dev/null 2>&1; then
    echo -e "${YELLOW}⚠️  pip not available for system Python. Creating local virtualenv...${NC}"
    $PYTHON_CMD -m venv .venv
    PYTHON_CMD="$(pwd)/.venv/bin/python"
fi

if ! $PYTHON_CMD -m pip install -r requirements.txt; then
    echo -e "${YELLOW}⚠️  Dependency installation failed.${NC}"
    echo "   Check network access or install requirements manually with:"
    echo "   $PYTHON_CMD -m pip install -r requirements.txt"
    exit 1
fi
echo -e "${GREEN}✓ Dependencies installed${NC}"

# Step 2: Generate protobuf code
echo ""
echo -e "${BLUE}Step 2: Generating protobuf code...${NC}"
if ! $PYTHON_CMD -m grpc_tools.protoc -I. --python_out=. --grpc_python_out=. ai_service.proto; then
    echo -e "${YELLOW}⚠️  Protobuf generation failed. Make sure grpcio-tools is installed:${NC}"
    echo "   $PYTHON_CMD -m pip install grpcio-tools"
    exit 1
fi

if [ -f ai_service_pb2.py ] && [ -f ai_service_pb2_grpc.py ]; then
    echo -e "${GREEN}✓ Protobuf code generated${NC}"
    ls -lh ai_service_pb2.py ai_service_pb2_grpc.py | awk '{print "  " $9 " (" $5 ")"}'
else
    echo -e "${YELLOW}⚠️  Protobuf generation failed${NC}"
    exit 1
fi

# Step 3: Check for Ollama
echo ""
echo -e "${BLUE}Step 3: Checking Ollama...${NC}"
if command -v ollama &> /dev/null; then
    echo -e "${GREEN}✓ Ollama found: $(ollama --version)${NC}"
    
    # Check if Ollama is running
    if curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Ollama is running on localhost:11434${NC}"
        
        # Check for models
        MODELS=$(curl -s http://localhost:11434/api/tags | grep -o '"name":"[^"]*"' | wc -l)
        if [ $MODELS -gt 0 ]; then
            echo -e "${GREEN}✓ Found $MODELS Ollama models${NC}"
        else
            echo -e "${YELLOW}⚠️  No Ollama models found. Run: ollama pull mistral${NC}"
        fi
    else
        echo -e "${YELLOW}⚠️  Ollama not running. Start with: ollama serve${NC}"
    fi
else
    echo -e "${YELLOW}⚠️  Ollama not installed. Download from: https://ollama.ai${NC}"
fi

# Step 4: Show next steps
echo ""
echo -e "${GREEN}===== Setup Complete! =====${NC}"
echo ""
echo "Next steps:"
echo ""
echo -e "${BLUE}1. Start Ollama (in terminal 1):${NC}"
echo "   ollama serve"
echo ""
echo -e "${BLUE}2. Start Python gRPC Service (in terminal 2):${NC}"
echo "   cd python-ai-service"
echo "   $PYTHON_CMD server.py"
echo ""
echo -e "${BLUE}3. Build and run Tauri app (in terminal 3):${NC}"
echo "   npm run tauri:dev"
echo ""
echo "For detailed testing instructions, see: TESTING_GRPC_GUIDE.md"
echo ""
echo "======================================================================"
