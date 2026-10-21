package app.zhiheng.assets;

import java.io.*;
import java.net.*;
import java.security.MessageDigest;
import java.util.concurrent.atomic.AtomicBoolean;

/** Bounded streaming transfer. No browser cookies, credentials or financial data. */
final class ApkTransfer {
    interface Progress { void update(long bytes); }
    interface Connector { HttpURLConnection open(URL url) throws IOException; }
    static final class Stop {
        final AtomicBoolean stopped = new AtomicBoolean();
        volatile HttpURLConnection connection;
        volatile String reason = "下载已取消";
        void cancel(String message) {
            reason = message; stopped.set(true);
            HttpURLConnection active = connection;
            if (active != null) active.disconnect();
        }
        void check() throws IOException { if (stopped.get()) throw new IOException(reason); }
    }
    static String downloadUrl(String version) {
        if (version == null || !version.matches("[0-9]+\\.[0-9]+\\.[0-9]+")) throw new IllegalArgumentException("无效版本号");
        return "https://github.com/xxxxaa/zhiheng/releases/download/v" + version + "/zhiheng-" + version + "-android.apk";
    }
    static void checkUrl(URL url, String original) throws IOException {
        String host = url.getHost();
        if (!"https".equals(url.getProtocol()) || url.getUserInfo() != null || url.getRef() != null || (url.getPort() != -1 && url.getPort() != 443))
            throw new IOException("安装包下载地址不安全");
        if ("github.com".equals(host)) {
            if (!url.getPath().equals(new URL(original).getPath())) throw new IOException("安装包跳转到了其他路径");
        } else if (!"release-assets.githubusercontent.com".equals(host) && !"objects.githubusercontent.com".equals(host)) {
            throw new IOException("安装包跳转到了非 GitHub 下载地址");
        }
    }
    static void transfer(String url, long bytes, String sha256, File part, Stop stop, Progress progress, Connector connector) throws Exception {
        if (bytes < 1 || bytes > 200L * 1024 * 1024 || sha256 == null || !sha256.matches("[a-f0-9]{64}")) throw new IOException("安装包校验信息无效");
        HttpURLConnection connection = null;
        boolean complete = false;
        try {
            URL next = new URL(url);
            for (int redirects = 0; ; redirects++) {
                stop.check(); checkUrl(next, url);
                connection = connector.open(next); stop.connection = connection;
                connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout(15000); connection.setReadTimeout(15000);
                connection.setRequestProperty("Accept", "application/octet-stream");
                connection.setRequestProperty("Accept-Encoding", "identity");
                connection.setRequestProperty("User-Agent", "Zhiheng-Android-Updater");
                stop.check();
                int code = connection.getResponseCode();
                if (code == 301 || code == 302 || code == 303 || code == 307 || code == 308) {
                    if (redirects >= 5) throw new IOException("下载跳转过多，请稍后重试");
                    String location = connection.getHeaderField("Location");
                    if (location == null) throw new IOException("下载跳转地址缺失");
                    next = new URL(next, location);
                    connection.disconnect(); connection = null; stop.connection = null;
                    continue;
                }
                if (code != 200) throw new IOException("安装包下载失败（HTTP " + code + "），请稍后重试");
                long length = connection.getContentLengthLong();
                if (length >= 0 && length != bytes) throw new IOException("安装包大小与发布信息不一致");
                break;
            }
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(part)) {
                byte[] buffer = new byte[64 * 1024];
                long received = 0;
                while (received < bytes) {
                    stop.check();
                    int count = input.read(buffer, 0, (int)Math.min(buffer.length, bytes - received));
                    if (count < 0) throw new IOException("安装包下载不完整，请重试");
                    if (count == 0) continue;
                    output.write(buffer, 0, count); digest.update(buffer, 0, count);
                    received += count; progress.update(received);
                }
                // The declared number of bytes plus the trusted digest defines completion.
                // Do not wait indefinitely for the server to close an otherwise complete body.
                stop.check(); output.getFD().sync();
            }
            if (!hex(digest.digest()).equals(sha256)) throw new IOException("安装包摘要校验失败，请重新下载");
            stop.check(); complete = true;
        } catch (SocketTimeoutException e) {
            throw new IOException("连接或传输超过 15 秒没有响应，请检查网络后重试", e);
        } finally {
            if (connection != null) connection.disconnect();
            stop.connection = null;
            if (!complete) part.delete();
        }
    }
    static String hash(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream input = new FileInputStream(file)) {
            byte[] buffer = new byte[64 * 1024]; int count;
            while ((count = input.read(buffer)) != -1) digest.update(buffer, 0, count);
        }
        return hex(digest.digest());
    }
    static String hex(byte[] bytes) {
        StringBuilder result = new StringBuilder();
        for (byte value : bytes) result.append(String.format(java.util.Locale.ROOT, "%02x", value & 255));
        return result.toString();
    }
}
