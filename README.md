# Repo Analysis Tool (RAT)

This app helps you look at a Git repository and see who changed what, which files changed the most, and how much code was added or removed.

You can use it to analyse a repository by either:

- cloning a Git repository from a URL, or
- uploading a `.zip` file that contains a Git repository.

The app runs locally on your own computer in a web browser.

## What you need before starting

You only need to install these once.

### 1. Install Node.js

Node.js lets your computer run this app.

1. Open this website in your browser: https://nodejs.org/
2. Download the version marked **LTS**.
3. Run the installer.
4. Keep clicking **Next** unless you know you need to change something.
5. When it finishes, restart your terminal or command prompt.

To check that Node.js installed correctly, run:

```bash
node --version
```

You should see a version number, for example:

```text
v20.10.0
```

### 2. Install Git

Git lets the app clone and inspect repositories.

1. Open this website in your browser: https://git-scm.com/downloads
2. Download Git for your operating system.
3. Run the installer.
4. Keep the default options unless you know you need to change something.

To check that Git installed correctly, run:

```bash
git --version
```

You should see a version number, for example:

```text
git version 2.43.0
```

## How to run the app

### Step 1: Open a terminal

Use the terminal for your operating system:

- **Windows:** open **Command Prompt** or **PowerShell**.
- **macOS:** open **Terminal**.
- **Linux:** open **Terminal**.

### Step 2: Go to the project folder

Move into the folder that contains this project.

For example, if the project is on your Desktop:

```bash
cd Desktop/SDP_TEST
```

If your folder is somewhere else, replace the path with the correct folder location.

### Step 3: Install the app files

Run this command:

```bash
npm install
```

This downloads the files the app needs in order to run.

You only need to do this the first time, or after the app dependencies change.

### Step 4: Start the app

Run this command:

```bash
npm start
```

You should see a message like this:

```text
RAT dashboard running on http://localhost:3000
```

### Step 5: Open the app in your browser

Open your browser and go to:

```text
http://localhost:3000
```

The Repo Analysis Tool dashboard should appear.

## How to use the app

### Option A: Analyse a repository from a URL

Use this if the repository is on GitHub, GitLab, Bitbucket, or another Git server.

1. Find the repository URL.
   - Example: `https://github.com/DaveGamble/cJSON.git`
2. Paste the URL into the **Remote URL** box.
3. Optionally type a friendly name in the **Name** box.
4. If you need results from a specific commit, paste the commit hash into **Reference commit or branch**. Otherwise, leave it blank.
5. Click **Clone and analyse**.
6. Wait for the app to finish.

Small repositories are usually quick. Large repositories can take longer.

### Option B: Analyse a repository from a zip file

Use this if someone gave you a zipped Git repository.

Important: the zip file must contain the repository’s `.git` folder or `.git` file.

1. Click **Choose File** under **Zip file**.
2. Select the `.zip` file.
3. Optionally type a friendly name in the **Name** box.
4. If you need results from a specific commit, paste the commit hash into **Reference commit or branch**. Otherwise, leave it blank.
5. Click **Upload and analyse**.
6. Wait for the app to finish.

## What the dashboard shows

The dashboard includes:

- **Selected commits:** how many commits are included in the current view.
- **Repository added:** total lines added.
- **Repository removed:** total lines removed.
- **Repository growth:** added lines minus removed lines.
- **Repository churn:** added lines plus removed lines.
- **Object metrics:** metrics for files and directories.
- **Author totals:** how much each author changed.
- **Manual author merge:** a tool for combining author names that belong to the same person.

## Filtering the results

You can narrow the dashboard using the filter controls.

### Repository

Choose which analysed repository you want to view.

### Author

Choose one author to only see changes by that person.

### Object type

Choose:

- **All** to show files and directories.
- **Files** to show only files.
- **Directories** to show only directories.

### Path

Type a file or folder path to focus on one part of the repository.

Examples:

```text
src
src/app.js
README.md
```

### Start date and end date

Use these to only include commits from a certain time period.

### Manual commit set

Paste one or more commit hashes if you only want to analyse specific commits.

You can separate commits with spaces, commas, or new lines.

## Merging authors

Sometimes Git shows the same person as multiple authors because they used different names or email addresses.

For example:

```text
Bob <bob@example.com>
Robert <rob@example.com>
```

If these are the same person:

1. In **Canonical author**, choose the name you want to keep.
2. In **Aliases**, select the other name or names.
3. Click **Merge selected aliases**.
4. The app will reanalyse the repository using the merged author names.

The app also uses Git’s `.mailmap` support automatically when the repository has one.

## Stopping the app

Go back to the terminal where the app is running.

Press:

```text
Ctrl + C
```

If it asks whether to stop, type:

```text
y
```

Then press **Enter**.

## Common problems

### `npm` is not recognized

Node.js is probably not installed, or the terminal was opened before Node.js was installed.

Try this:

1. Close the terminal.
2. Open a new terminal.
3. Run:

```bash
node --version
npm --version
```

If those commands still do not work, reinstall Node.js from https://nodejs.org/.

### `git` is not recognized

Git is probably not installed.

Install it from https://git-scm.com/downloads, then open a new terminal and run:

```bash
git --version
```

### The browser says the site cannot be reached

Make sure the app is still running in the terminal.

You should see:

```text
RAT dashboard running on http://localhost:3000
```

If not, run:

```bash
npm start
```

### Port 3000 is already being used

Another app may already be using port 3000.

The app will now automatically try the next port, such as `3001` or `3002`.

Look at the terminal message after running `npm start`. It will tell you the correct address to open, for example:

```text
RAT dashboard running on http://localhost:3001
```

If you want to choose a port yourself, use:

```bash
PORT=3001 npm start
```

Then open:

```text
http://localhost:3001
```

On Windows PowerShell, use:

```powershell
$env:PORT=3001; npm start
```

### Cloning takes a long time

Large repositories can take a long time to clone and analyse. Try a smaller repository first to confirm everything works.

Example test repository:

```text
https://github.com/DaveGamble/cJSON.git
```

## Running tests

If you want to check that the metric engine is working, run:

```bash
npm test
```

You should see that the tests pass.

## Notes for developers

Main project files:

- `server.js` starts the web server and defines the API.
- `src/git.js` runs Git commands.
- `src/metrics.js` calculates repository metrics.
- `src/store.js` saves repository records and metric results.
- `public/` contains the dashboard page.
- `test/metrics.test.js` contains automated metric tests.

Generated local data is saved in `data/` and uploaded zip files are saved temporarily in `uploads/`. These folders are ignored by Git.
