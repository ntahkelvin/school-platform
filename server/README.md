# Running the platform on a server (Proxmox VM or a cloud server)

1. Make an Ubuntu Server 24.04 machine (2 CPUs, 4 GB RAM, 40 GB disk) with OpenSSH.
2. Copy the zip to it and unpack:  `unzip school-platform-*.zip -d school-platform && cd school-platform`
3. Install:  `sudo ./server/install.sh`  (or `sudo ./server/install.sh laptop-data.sql.gz` to bring your data)
4. See the link and health at any time:  `school-status`

Everyday commands on the server:

| Command | What it does |
|---|---|
| `school-status` | Is everything running? Shows the links and a QR code |
| `sudo school-update` | Newest version from GitHub (after `sudo /opt/school-platform/server/link-github.sh`) |
| `sudo school-update file.zip` | Update from a zip |
| `sudo school-backup` | Back up now (also runs every night at 2:30 am, kept 14 days) |

Backups are in `/var/backups/school-platform`. The app lives in `/opt/school-platform`.
