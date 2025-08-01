#!/bin/bash

# Script to sync audio files from host uploads directory to Asterisk container
# Converts MP3 to WAV format and copies to container

UPLOADS_DIR="./uploads"
CONTAINER_NAME="asterisk-p1"
CONTAINER_AUDIO_DIR="/usr/share/asterisk/sounds/uploads"

echo "Starting audio sync process..."

# Check if container is running
if ! docker ps | grep -q "$CONTAINER_NAME"; then
    echo "Error: Container $CONTAINER_NAME is not running"
    exit 1
fi

# Create temporary directory for converted files
TEMP_DIR=$(mktemp -d)
echo "Using temporary directory: $TEMP_DIR"

# Process each MP3 file in uploads directory
for mp3_file in "$UPLOADS_DIR"/*.mp3; do
    if [ -f "$mp3_file" ]; then
        filename=$(basename "$mp3_file" .mp3)
        wav_file="$TEMP_DIR/${filename}.wav"
        
        echo "Converting $mp3_file to WAV format..."
        
        # Convert MP3 to WAV (16-bit, 8kHz, mono) - Asterisk compatible format
        if command -v ffmpeg &> /dev/null; then
            ffmpeg -i "$mp3_file" -ar 8000 -ac 1 -ab 64k -f wav "$wav_file" -y &> /dev/null
        elif command -v sox &> /dev/null; then
            sox "$mp3_file" -r 8000 -c 1 "$wav_file"
        else
            echo "Error: Neither ffmpeg nor sox found. Please install one of them."
            rm -rf "$TEMP_DIR"
            exit 1
        fi
        
        if [ -f "$wav_file" ]; then
            echo "Successfully converted: ${filename}.mp3 -> ${filename}.wav"
            
            # Copy WAV file to container
            echo "Copying ${filename}.wav to container..."
            docker cp "$wav_file" "$CONTAINER_NAME:$CONTAINER_AUDIO_DIR/"
            
            if [ $? -eq 0 ]; then
                echo "✓ Successfully copied ${filename}.wav to container"
            else
                echo "✗ Failed to copy ${filename}.wav to container"
            fi
        else
            echo "✗ Failed to convert ${filename}.mp3"
        fi
    fi
done

# Clean up temporary directory
rm -rf "$TEMP_DIR"

echo ""
echo "Audio sync completed. Current files in container:"
docker exec "$CONTAINER_NAME" ls -la "$CONTAINER_AUDIO_DIR/"

echo ""
echo "To automatically sync new files, you can run this script again or set up a file watcher."
