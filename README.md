# gemini-stack

`gemini-stack` is a powerful Gemini-powered CLI tool designed to streamline development workflows. It leverages the Google Gemini API to provide intelligent code reviews, automated shipping workflows, and product/engineering planning assistance.

## Features

`gemini-stack` provides several "skills" to help you in different stages of development:

- **`review`**: Performs automated code reviews. 
    - Analyzes uncommitted changes or PR diffs against `origin/main`.
    - Use `--full` mode to audit the entire codebase.
- **`ship`**: A non-interactive, fully automated workflow to ship your code.
    - Merges `main`, runs tests/evals, performs a pre-landing review, bumps versions, updates CHANGELOG/TODOS, and creates a PR.
- **`plan-ceo`**: Get product vision feedback from a "rigorous CEO".
    - Evaluates feature ideas and provides sharp, critical pushback to find the "10-star" version.
- **`plan-eng`**: Generate high-level technical plans from a "Senior Engineer".
    - Focuses on architecture, resilience, state management, and error handling.
- **`checklist`**: The underlying pre-landing review checklist used by `ship` and `review`.

## Setup

### Prerequisites

- **Node.js**: Ensure you have Node.js installed (v18+ recommended).
- **Gemini API Key**: Obtain an API key from [Google AI Studio](https://aistudio.google.com/).

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/your-repo/gemini-stack.git
   cd gemini-stack
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure environment variables:
   Create a `.env` file in the root directory and add your API key:
   ```env
   GEMINI_API_KEY=your_actual_api_key_here
   ```

4. Link the CLI tool (optional, for global access):
   ```bash
   npm link
   ```
   Now you can use the `g-stack` command from anywhere.

## Usage

The basic syntax is:
```bash
g-stack <skill-name> [options] [prompt]
```

### Examples

#### Automated Code Review
Review uncommitted changes:
```bash
g-stack review
```
Review the entire project:
```bash
g-stack review --full
```

#### Shipping a Feature
Run the automated shipping workflow (best from a feature branch):
```bash
g-stack ship
```

#### Planning a New Feature
Get product feedback:
```bash
g-stack plan-ceo "I want to add a real-time collaboration feature to the editor"
```
Get a technical implementation plan:
```bash
g-stack plan-eng "Implementing a WebSocket-based sync engine for the editor"
```

## Configuration

The default model is `gemini-3-flash-preview`. You can adjust chunk sizes and delays in `index.js` to match your API tier limits.
