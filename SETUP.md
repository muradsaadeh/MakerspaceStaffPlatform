# The Makerspace Staff Platform: setup

These files replace your current `index.html`, `admin.html` and `staff.html`. They use the same Firebase project and the same schedule data. The new files are `common.js`, `ops.js` and `ops.css`, and all six go in the same GitHub Pages folder.

## 1. Firebase console (one time, about 10 minutes)

1. **Turn on email logins.** Go to **Authentication → Sign-in method → Email/Password** and set it to **Enable**.
2. **Allow your website.** Go to **Authentication → Settings → Authorized domains → Add domain** and add `YOUR-USERNAME.github.io`.
3. **Create your own account.** Go to **Authentication → Users → Add user** and enter your email and a password.
4. **Lock the database.** Go to **Realtime Database → Rules**, paste the contents of `database.rules.json`, then click **Publish**.
   - Until you do this, anyone who has the page's code can read and change the database.
   - Because of the rules, the old shared admin password no longer protects anything.

## 2. First sign-in

1. Upload the six files to your GitHub repo.
2. Open the site and sign in with the account from step 1.3.
3. You'll see **"First-time setup → Make me the admin"**. Click it straight away. This option only exists while there are no admins at all.
4. In **Admin → Names**, make sure each person has an email.
5. Click **Create login** for each person and choose junior, senior or admin. They'll get an email from Firebase to set their own password.
   - If the email lands in spam, the first one may need a "Not spam" click.
6. In **Admin → Machines**, click **Load starter list from Planner**. This imports the machines and checklists from your Teams Planner board, all set to monthly.
   - Roland BD-8 also gets its daily cleaning test.
   - Afterwards, edit the frequencies, serial numbers and purchase dates.

## 3. Email alerts (optional)

In `common.js`, set `EMAILJS_CONFIG.siteUrl` to your GitHub Pages address.

New-issue alerts reuse your existing EmailJS template:

- `month_label` carries the subject line.
- `admin_message` carries the issue text.

If you'd like a separate template for issue alerts, put its ID in `issueTemplateId`.

## Who can do what

| | Junior | Senior | Admin |
|---|---|---|---|
| My Day, schedules, calendar (view) | ✓ | ✓ | ✓ |
| Do preventive checks, report problems | ✓ | ✓ | ✓ |
| Sign off checks, update/resolve issues, log repairs | | ✓ | ✓ |
| Add/edit calendar events, machines and checklists | | ✓ | ✓ |
| Maintenance logs + Excel export | | ✓ | ✓ |
| Edit rotation schedule, staff and logins | | | ✓ |

## Moving old history in

To back-fill old checks:

1. As a senior, open a check from **Maintenance**.
2. Change the **Check date** at the top to an older month and fill it in.
3. It lands in that month's row of the log.

For old repairs, use **Issues → + Log a repair** and set the date.
