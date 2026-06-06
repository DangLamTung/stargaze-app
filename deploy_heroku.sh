#!/bin/bash

# Ensure we are in a git repository
if [ ! -d ".git" ]; then
    echo "Initializing git repository..."
    git init
    git add .
    git commit -m "Initial commit for Heroku"
fi

# Check if Heroku CLI is installed
if ! command -v heroku &> /dev/null; then
    echo "Heroku CLI is not installed!"
    echo "Please install it from: https://devcenter.heroku.com/articles/heroku-cli"
    exit 1
fi

echo "Logging into Heroku..."
heroku login

echo "Creating new Heroku app..."
# Create a unique app name, or let Heroku pick one
heroku create stargaze-app-$RANDOM

echo "Deploying to Heroku..."
git push heroku main || git push heroku master

echo "Opening app in browser..."
heroku open
