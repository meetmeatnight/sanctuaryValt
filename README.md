# Our Sanctuary — Private Document Vault

A private, password-protected website where you and your loved ones can read documents (PDFs, photos) online — without being able to download or share them.

---

## Quick Setup (5 steps)

### Step 1 — Generate your password hash

1. Open `setup.html` in your browser (just double-click the file — no server needed)
2. Type your chosen password and confirm it
3. Click **Generate Hash**
4. Click **Copy to clipboard**

> Keep `setup.html` on your own computer. Do not upload it to GitHub.

---

### Step 2 — Set your password

Open `js/config.js` in Notepad (or any text editor) and replace:

```
passwordHash: 'REPLACE_WITH_YOUR_PASSWORD_HASH',
```

with the hash you just copied. Also update:

- `siteTitle` — the name shown on the site
- `welcomeMessage` — the text shown after login
- `backgroundImage` — the path to your background photo

---

### Step 3 — Add your background photo

1. Find a beautiful photo you want as the background
2. Name it `background.jpg`
3. Place it in the `assets/` folder

---

### Step 4 — Add your documents

For each PDF or image you want to add:

**a)** Copy the file into the `docs/` folder

**b)** Open `documents.json` and add an entry:

```json
{
    "id": "unique-id",
    "title": "Document Title",
    "type": "pdf",
    "path": "docs/your-filename.pdf",
    "coverClass": "cover-1",
    "description": "A short description shown on the card",
    "date": "June 2024"
}
```

**For `type`:** use `pdf` for PDFs, or the image extension (`jpg`, `png`, `webp`, etc.)

**For `coverClass`:** choose a card colour — `cover-1` through `cover-6`:
- `cover-1` — rose & amber (warm)
- `cover-2` — twilight purple
- `cover-3` — deep forest green
- `cover-4` — dark amber
- `cover-5` — ocean blue
- `cover-6` — plum

**Optional:** add `"coverImage": "assets/covers/my-cover.jpg"` to use your own cover photo for a card.

---

### Step 5 — Deploy to GitHub Pages

**a) Create a GitHub repository**
- Go to [github.com](https://github.com) → click **New**
- Choose any name (e.g. `our-sanctuary`)
- Set visibility to **Public** *(required for free GitHub Pages)*
- Click **Create repository**

**b) Upload your files**
- On the new repo page, click **uploading an existing file**
- Drag ALL files from your `romantic-vault` folder (keep the folder structure)
- Write a commit message (e.g. "initial") and click **Commit changes**

**c) Enable GitHub Pages**
- Go to **Settings → Pages**
- Under *Source*, select: **Deploy from a branch**
- Branch: `main`, folder: `/ (root)`
- Click **Save**

**d) Your site is live at:**
```
https://YOUR-USERNAME.github.io/YOUR-REPO-NAME/
```

GitHub will send you an email when it's deployed (usually 1–2 minutes).

---

## Adding more documents later

1. Go to your GitHub repo
2. Click **Add file → Upload files**
3. Upload the new file to the `docs/` folder
4. Edit `documents.json` to add the new entry
5. Commit — the site updates automatically

---

## Security at a glance

**What IS protected:**
- Password required to access anything
- PDFs and images rendered to canvas — no download link is shown
- Right-click, Ctrl+S, Ctrl+P, F12, and DevTools shortcuts are blocked
- Content hidden from Google and other search engines
- Session clears automatically when the browser is closed

**What CANNOT be fully prevented (on any website):**
- Phone camera or OS-level screenshots
- Browser extensions
- Determined technical users (since the repo is public, file URLs are technically accessible if someone knows the exact filename)

**Tips for stronger privacy:**
- Use random filenames for your documents (e.g. `docs/a7f3k2.pdf`) so they are hard to guess
- Do not share the GitHub repository link publicly — only share your GitHub Pages URL
- Consider a private GitHub repository with [GitHub Pro](https://github.com/pricing) ($4/month) — this hides your source files completely

---

## Customising colours

Open `css/style.css` and edit the `:root` block at the top to change any colour or font.

---

*Built for two eyes only.*
