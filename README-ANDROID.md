# Shoaib Launcher - Android APK (GitHub se build)

Ye folder ek complete Android project hai. APK GitHub ke servers par banta hai (free), tum phone par download karte ho.

## Termux se push karne ke steps
1. github.com/new par ek **khali** repo banao (naam: `shoaib-launcher-android`, Private theek hai). README/gitignore add MAT karo.
2. GitHub → Settings → Developer settings → Personal access tokens → **Tokens (classic)** → Generate new token. Scopes: **repo** aur **workflow**. Token copy karke rakho (kisi ko mat dena).
3. Termux mein:
```
pkg install -y git unzip
cd ~ && rm -rf shoaib-android && mkdir shoaib-android && cd shoaib-android
unzip ~/downloads/sblauncher-android.zip
git config --global user.name "TumharaNaam"
git config --global user.email "tumhara@email.com"
git init -b main
git add -A
git commit -m "Shoaib Launcher Android"
git remote add origin https://github.com/USERNAME/shoaib-launcher-android.git
git push -u origin main
```
`USERNAME` apna GitHub username likho. Push ke waqt **Username** = GitHub username, **Password** = wo token.
4. GitHub repo → **Actions** tab → "Build APK" khud chalega (8-15 minute).
5. Hara tick aane par repo ke **Releases** (right side) mein jao → `ShoaibLauncher.apk` download karo aur install karo (Android "unknown source" allow karne ko kahega).
6. Agar build **laal (red)** ho: us run par tap karo, jo step laal hai uska log (aakhri 40 lines) copy karke Claude ko bhejo.

## Kya karta hai
App khulte hi andar Node.js engine (nodejs-mobile) start hota hai aur UI WebView mein dikhta hai. Versions download, Modrinth/CurseForge, worlds, backups, Shoaib+ chalte hain.
**Game khelna (Play) isme nahi hai**: Minecraft ki desktop libraries Android load nahi kar sakta. Data phone par `Android/data/com.modbyshoaib.launcher/files/ShoaibLauncher` mein rehta hai.
