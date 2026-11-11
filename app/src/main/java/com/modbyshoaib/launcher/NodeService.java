package com.modbyshoaib.launcher;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.os.IBinder;
import android.os.PowerManager;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.SecureRandom;

/** Keeps the Node.js engine (the launcher backend) alive, also when the app is in the background. */
public class NodeService extends Service {
    static final String CHANNEL = "shoaib-engine";
    static final int PORT = 8787;
    private static boolean started = false;
    private PowerManager.WakeLock wakeLock;

    /** Random access token for the local web server, created once per install. */
    static String token(Context c) {
        SharedPreferences p = c.getSharedPreferences("shoaib", Context.MODE_PRIVATE);
        String t = p.getString("token", null);
        if (t == null || !t.matches("[a-f0-9]{48}")) {
            byte[] b = new byte[24];
            new SecureRandom().nextBytes(b);
            StringBuilder sb = new StringBuilder();
            for (byte x : b) sb.append(String.format("%02x", x & 0xff));
            t = sb.toString();
            p.edit().putString("token", t).apply();
        }
        return t;
    }

    /** Where versions, mods and worlds are stored (app folder on phone storage, no permission needed). */
    static File dataDir(Context c) {
        File base = c.getExternalFilesDir(null);
        if (base == null) base = c.getFilesDir();
        File d = new File(base, "ShoaibLauncher");
        d.mkdirs();
        return d;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Launcher engine", NotificationManager.IMPORTANCE_LOW));
        PendingIntent pi = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE);
        Notification n = new Notification.Builder(this, CHANNEL)
                .setContentTitle("Shoaib Launcher")
                .setContentText("Engine running. Downloads continue in the background.")
                .setSmallIcon(android.R.drawable.stat_sys_download)
                .setContentIntent(pi)
                .setOngoing(true)
                .build();
        startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);

        if (wakeLock == null) {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "shoaib:engine");
            wakeLock.acquire();
        }
        synchronized (NodeService.class) {
            if (!started) {
                started = true;
                startEngine();
            }
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        super.onDestroy();
    }

    private void startEngine() {
        try {
            File app = new File(getFilesDir(), "shoaib");
            copyAssetsIfNeeded(app);
            File home = new File(getFilesDir(), "home");
            home.mkdirs();
            File data = dataDir(this);
            final String[] args = {"node", new File(app, "src/web.js").getAbsolutePath(), "--port", String.valueOf(PORT)};
            final String[] env = {
                    "HOME=" + home.getAbsolutePath(),
                    "SHOAIB_HOME=" + data.getAbsolutePath(),
                    "TMPDIR=" + getCacheDir().getAbsolutePath(),
                    "SHOAIB_WEB_TOKEN=" + token(this)
            };
            final File log = new File(data, "web.log");
            Thread t = new Thread(null, () -> {
                int code = NodeBridge.startNodeWithArguments(args, env);
                try {
                    Files.write(log.toPath(), ("Engine stopped with code " + code + "\n").getBytes(StandardCharsets.UTF_8),
                            java.nio.file.StandardOpenOption.CREATE, java.nio.file.StandardOpenOption.APPEND);
                } catch (IOException ignored) {
                    // nothing else to do
                }
            }, "node-main", 8L * 1024 * 1024);
            t.start();
        } catch (Throwable e) {
            try {
                File log = new File(dataDir(this), "web.log");
                Files.write(log.toPath(), ("Could not start the engine: " + e + "\n").getBytes(StandardCharsets.UTF_8),
                        java.nio.file.StandardOpenOption.CREATE, java.nio.file.StandardOpenOption.APPEND);
            } catch (IOException ignored) {
                // nothing else to do
            }
        }
    }

    /** Copies the bundled launcher files out of the APK; repeated after every install or update. */
    private void copyAssetsIfNeeded(File dest) throws Exception {
        long stamp = getPackageManager().getPackageInfo(getPackageName(), 0).lastUpdateTime;
        File mark = new File(dest, ".stamp");
        if (mark.exists() && new String(Files.readAllBytes(mark.toPath()), StandardCharsets.UTF_8).trim().equals(String.valueOf(stamp))) return;
        deleteRecursive(dest);
        copyAsset("shoaib", dest);
        Files.write(mark.toPath(), String.valueOf(stamp).getBytes(StandardCharsets.UTF_8));
    }

    private void copyAsset(String path, File out) throws IOException {
        String[] kids = getAssets().list(path);
        if (kids == null || kids.length == 0) {
            File parent = out.getParentFile();
            if (parent != null) parent.mkdirs();
            try (InputStream in = getAssets().open(path); OutputStream os = new FileOutputStream(out)) {
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
            }
        } else {
            out.mkdirs();
            for (String k : kids) copyAsset(path + "/" + k, new File(out, k));
        }
    }

    private static void deleteRecursive(File f) {
        if (!f.exists()) return;
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteRecursive(k);
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }
}
