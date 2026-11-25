# Security

Please report a vulnerability, or any leak of personal data you spot in this repo (a real name, email address, phone number, or something that looks like private job-search data), privately: open the repo's **Security** tab and choose **Report a vulnerability**. Don't open a public issue for it.

You'll get a reply within a week. This is a small personal project, so there is no bug bounty, but credit is given in the fix if you'd like it.

Repo checks: `npm run check:private` scans for personal-data patterns, and Dependabot keeps dependencies current. The README says what data leaves your machine when you run the agent.
