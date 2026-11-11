package com.modbyshoaib.launcher;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.view.Gravity;
import android.view.View;
import android.webkit.JsPromptResult;
import android.webkit.JsResult;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.io.File;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends Activity {
    private static final int REQ_FILE = 1;
    private static final int REQ_NOTIFICATIONS = 2;

    private WebView web;
    private TextView status;
    private ValueCallback<Uri[]> chooserCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFF060A12);

        web = new WebView(this);
        web.setBackgroundColor(0xFF060A12);
        web.setVisibility(View.INVISIBLE);

        status = new TextView(this);
        status.setTextColor(0xFFEAF2FF);
        status.setTextSize(16);
        status.setGravity(Gravity.CENTER);
        status.setPadding(48, 48, 48, 48);

        root.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        root.addView(status, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);

        configureWebView();
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIFICATIONS);
        }
        startEngineAndWait();
    }

    private void configureWebView() {
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setSupportMultipleWindows(false);
        WebView.setWebContentsDebuggingEnabled(true);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if ("127.0.0.1".equals(u.getHost())) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, u));
                } catch (Exception ignored) {
                    // no app can open this link
                }
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView w, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (chooserCallback != null) chooserCallback.onReceiveValue(null);
                chooserCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), REQ_FILE);
                } catch (Exception e) {
                    chooserCallback = null;
                    return false;
                }
                return true;
            }

            @Override
            public boolean onJsAlert(WebView v, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this).setMessage(message)
                        .setPositiveButton(android.R.string.ok, (d, w) -> result.confirm())
                        .setOnCancelListener(d -> result.cancel()).show();
                return true;
            }

            @Override
            public boolean onJsConfirm(WebView v, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this).setMessage(message)
                        .setPositiveButton(android.R.string.ok, (d, w) -> result.confirm())
                        .setNegativeButton(android.R.string.cancel, (d, w) -> result.cancel())
                        .setOnCancelListener(d -> result.cancel()).show();
                return true;
            }

            @Override
            public boolean onJsPrompt(WebView v, String url, String message, String defaultValue, JsPromptResult result) {
                final EditText input = new EditText(MainActivity.this);
                if (defaultValue != null) input.setText(defaultValue);
                new AlertDialog.Builder(MainActivity.this).setMessage(message).setView(input)
                        .setPositiveButton(android.R.string.ok, (d, w) -> result.confirm(input.getText().toString()))
                        .setNegativeButton(android.R.string.cancel, (d, w) -> result.cancel())
                        .setOnCancelListener(d -> result.cancel()).show();
                return true;
            }
        });

        web.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) ->
                new Thread(() -> saveDownload(url, contentDisposition, mimeType)).start());
    }

    /** Saves an exported file (for example a .mrpack) from the local engine into the phone's Downloads folder. */
    private void saveDownload(String url, String contentDisposition, String mimeType) {
        try {
            HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
            final String name = URLUtil.guessFileName(url, contentDisposition, mimeType);
            ContentValues v = new ContentValues();
            v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
            v.put(MediaStore.MediaColumns.MIME_TYPE, mimeType == null ? "application/octet-stream" : mimeType);
            v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
            Uri target = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
            if (target == null) throw new Exception("Could not create the file");
            try (InputStream in = c.getInputStream(); OutputStream out = getContentResolver().openOutputStream(target)) {
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            }
            runOnUiThread(() -> Toast.makeText(this, "Saved to Downloads: " + name, Toast.LENGTH_LONG).show());
        } catch (Exception e) {
            final String msg = String.valueOf(e.getMessage());
            runOnUiThread(() -> Toast.makeText(this, "Download failed: " + msg, Toast.LENGTH_LONG).show());
        }
    }

    private void startEngineAndWait() {
        status.setVisibility(View.VISIBLE);
        status.setOnClickListener(null);
        status.setText("Starting Shoaib Launcher...");
        startForegroundService(new Intent(this, NodeService.class));
        new Thread(() -> {
            long t0 = System.currentTimeMillis();
            boolean ok = false;
            while (System.currentTimeMillis() - t0 < 90000) {
                if (ping()) {
                    ok = true;
                    break;
                }
                try {
                    Thread.sleep(500);
                } catch (InterruptedException e) {
                    return;
                }
            }
            final boolean up = ok;
            runOnUiThread(() -> {
                if (up) {
                    status.setVisibility(View.GONE);
                    web.setVisibility(View.VISIBLE);
                    web.loadUrl("http://127.0.0.1:" + NodeService.PORT + "/?t=" + NodeService.token(this));
                } else {
                    showError();
                }
            });
        }).start();
    }

    private boolean ping() {
        try {
            HttpURLConnection c = (HttpURLConnection) new URL("http://127.0.0.1:" + NodeService.PORT + "/").openConnection();
            c.setConnectTimeout(800);
            c.setReadTimeout(800);
            int code = c.getResponseCode();
            c.disconnect();
            return code == 200;
        } catch (Exception e) {
            return false;
        }
    }

    private void showError() {
        String tail = "";
        try {
            File log = new File(NodeService.dataDir(this), "web.log");
            if (log.exists()) {
                String[] lines = new String(Files.readAllBytes(log.toPath()), StandardCharsets.UTF_8).split("\n");
                List<String> last = new ArrayList<>();
                for (int i = Math.max(0, lines.length - 12); i < lines.length; i++) last.add(lines[i]);
                tail = String.join("\n", last);
            }
        } catch (Exception ignored) {
            // no log to show
        }
        status.setText("The launcher engine did not start.\n\n" + tail + "\n\nTap here to try again.");
        status.setOnClickListener(v -> startEngineAndWait());
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE && chooserCallback != null) {
            chooserCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            chooserCallback = null;
        } else {
            super.onActivityResult(requestCode, resultCode, data);
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
    }

    @Override
    public void onBackPressed() {
        moveTaskToBack(true);
    }
}
