# Kush Welding Services: website for Netlify (free)

The public website, plus the owner admin where the ad and project photos are changed.
Everything runs free on Netlify: no separate server, no database to set up.

---

## Put it online (about 15 minutes, once)

### Part 1. Put the files on GitHub (free)

1. Unzip `kush-welding-netlify.zip` on your computer.
2. Sign up at **github.com** (free), then click **+ → New repository**.
   Name it `kush-welding`, choose **Private**, leave everything else empty, click **Create repository**.
3. On the new empty repository page, click the link **uploading an existing file**.
4. Open the unzipped folder, select **everything inside it** (the `netlify`, `public`, `scripts`, `test` folders and the loose files) and drag it all into the GitHub page.
   Drag what is *inside* the folder, not the folder itself, so that `netlify.toml` sits at the top level.
5. Wait for the upload to finish, then click **Commit changes**.

### Part 2. Connect Netlify

1. Sign up at **app.netlify.com** (free; "Sign up with GitHub" is easiest).
2. Click **Add new project → Import an existing project → GitHub**, allow access, and choose the `kush-welding` repository.
3. Leave all settings as they are (they are read from `netlify.toml`) and click **Deploy**.
4. After about two minutes you get an address like `something.netlify.app`. Open it: that is your live website.

### Part 3. First login to the owner admin

1. Go to `https://YOUR-SITE.netlify.app/admin/`
2. Log in with the starting password you were given in the chat. You are asked to choose your own password straight away. Do that.
3. Open the **Account** tab and look at **System check**. The first two lines must have a green tick:
   *Storage for photos and ads is connected* and *Photo resizing is available*.
4. Test it: add a test ad and upload one photo, check them on the website, then delete the tests.

### Part 4. Give it a nicer name (optional)

Netlify: **Site configuration → Change site name** (for example `kush-welding` gives `kush-welding.netlify.app`).

### Part 5. When you buy a domain

Netlify: **Domain management → Add a domain**, then follow the DNS steps it shows.
The site picks up the new address by itself on the next deploy (canonical links, sitemap, Google and WhatsApp previews). To refresh immediately press **Deploys → Trigger deploy → Deploy site**.
Free HTTPS is switched on automatically.

---

## Using the admin (for the owner)

* **Advertisement tab:** add, edit, pause or **delete** ads (each ad has a red **Delete** button, and one inside the editor). Optional start and end dates schedule an ad automatically. All live ads rotate in the banner under the gold ticker. To keep an ad ready without showing it, switch **Active** off. With no live ad, the site shows the "Free site visit" message (or hides the area, your choice).
* **Photos tab:** tap **Add new photos**, choose photos from your phone or computer, check the titles, then choose what should happen to them:
  * **Publish now**: on the website straight away.
  * **Save, publish later**: stored here as a **Draft**; visitors cannot see it. Publish it any time with **Publish now**, or use **Publish all drafts**.
  * **Schedule**: pick a date and time (Nairobi time) and the photo goes live by itself. You can change the time or **Unschedule** it later.
  Filter the list with **All / Live / Drafts / Scheduled**. The eye button takes a live photo off the website and keeps it as a draft.
* **Account tab:** change your password.

Ads, photos and your password are stored in Netlify's own storage, **separate from the website files**. Updating or redeploying the site never removes them.

## Forgot the password

1. Netlify → your site → **Site configuration → Environment variables → Add a variable**
   Key `ADMIN_PASSWORD`, value any temporary password.
2. **Deploys → Trigger deploy → Deploy site**.
3. Log in with the temporary password. You will be asked to choose a new one. Nothing else is lost.

## Changing text or design later

Edit the files in your GitHub repository (or ask your developer). Netlify rebuilds the site automatically each time you save a change.

## If something looks wrong

* **System check shows a red cross for storage:** open Netlify → **Deploys** and make sure the latest deploy says *Published*. If it failed, open it and read the log, or send it to your developer.
* **"Photo resizing is available" is not ticked:** Photos still upload, but are not shrunk on the server. Try **Deploys → Trigger deploy → Clear cache and deploy site**.
* **Usage:** Netlify's free plan has monthly limits on traffic and function calls. A small business website normally stays well inside them. You can watch this under **Usage** in the Netlify dashboard.

---

## For developers

* Static site in `public/`. Three Netlify Functions in `netlify/functions/`:
  `admin-api` (`/api/admin`), `content` (`/content/content.json`), `media` (`/uploads/:folder/:name`).
* Data lives in Netlify Blobs: stores `kush-content` (content.json), `kush-uploads` (photos and ad images), `kush-private` (password hash, session secret, login lockouts).
* Images are re-encoded to WebP with `sharp` (strips metadata); photos max 1600 px with an 800 px thumbnail, ad banners max 1800 px.
* Photos have a state: live, draft or scheduled (`status` + `publishAt` in content.json). `/content/content.json` only ever contains live photos (drafts and not-yet-due scheduled ones are filtered on the server), and a scheduled photo appears by itself once its time passes, so no scheduler or cron job is needed.
* Login: scrypt password hash, signed HttpOnly SameSite=Strict cookie, CSRF header, 5 wrong tries = 15 minute lock per IP, logout revokes the session on the server.
* `scripts/set-domain.mjs` runs at build time and swaps the placeholder `https://kushwelding.co.ke` for `SITE_DOMAIN` or Netlify's `URL`.
* Tests: `npm install && INITIAL_PASSWORD=<starting password> npm test` runs the functions against a local stand-in for Blobs.
