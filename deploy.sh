#!/bin/bash

# TAPP v2 Deployment Script
# This script helps you deploy your Trading Alerts Tool

echo "🚀 TAPP v2 Deployment Helper"
echo "=============================="

# Check if git is initialized
if [ ! -d ".git" ]; then
    echo " Git repository not found. Please initialize git first:"
    echo "   git init"
    echo "   git add ."
    echo "   git commit -m 'Initial commit'"
    exit 1
fi

# Check if we're on main branch
current_branch=$(git branch --show-current)
if [ "$current_branch" != "main" ]; then
    echo "⚠️  You're not on the main branch. Current branch: $current_branch"
    read -p "Continue anyway? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Check if there are uncommitted changes
if [ -n "$(git status --porcelain)" ]; then
    echo "⚠️  You have uncommitted changes."
    git status --short
    echo
    read -p "Commit changes before deploying? (Y/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Nn]$ ]]; then
        echo "❌ Please commit your changes first."
        exit 1
    else
        read -p "Enter commit message: " commit_message
        if [ -z "$commit_message" ]; then
            commit_message="Deploy updates"
        fi
        git add .
        git commit -m "$commit_message"
        echo "✅ Changes committed."
    fi
fi

# Push to GitHub
echo "📤 Pushing to GitHub..."
git push origin main

if [ $? -eq 0 ]; then
    echo "✅ Successfully pushed to GitHub!"
    echo
    echo "🎯 Next Steps:"
    echo "=============="
    echo
    echo "1. 🚂 Deploy Backend to Railway:"
    echo "   - Go to https://railway.app"
    echo "   - Create new project from GitHub repo: lucabit-dev/TAPP-V2"
    echo "   - Set environment variables (see COMPLETE_DEPLOYMENT_GUIDE.md)"
    echo "   - Get your Railway URL"
    echo
    echo "2. ⚡ Deploy Frontend to Vercel:"
    echo "   - Go to https://vercel.com/dashboard"
    echo "   - Import GitHub repo: lucabit-dev/TAPP-V2"
    echo "   - Set environment variables with your Railway URL"
    echo
    echo "3. 📖 Follow the complete guide:"
    echo "   - Read COMPLETE_DEPLOYMENT_GUIDE.md for detailed instructions"
    echo
    echo "🔗 Your Repository: https://github.com/lucabit-dev/TAPP-V2"
    echo
    echo "✨ Happy Trading! 📈"
else
    echo "❌ Failed to push to GitHub. Please check your git configuration."
    exit 1
fi
