package app.zhiheng.assets;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.*;
import java.net.HttpURLConnection;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.concurrent.*;
import org.json.JSONObject;

@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {
    private static final String APP_ID = "app.zhiheng.assets";
    private static final String SIGNER = "0fb97ee5bf50a79946ee75f337bcc42b5f29471174473dd8c63718e459f0fa2b";
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final ScheduledExecutorService watchdog = Executors.newSingleThreadScheduledExecutor();
    private final Object lock = new Object();
    private String phase = "restoring", message = "正在检查已下载的安装包…";
    private long received, revision;
    private Spec target;
    private ApkTransfer.Stop active;
    private boolean installing;

    static final class Spec {
        final String version, sha256;
        final long versionCode, bytes;
        Spec(JSONObject input) throws Exception {
            version = input.getString("version"); ApkTransfer.downloadUrl(version);
            versionCode = input.getLong("versionCode"); bytes = input.getLong("bytes"); sha256 = input.getString("sha256");
            if (versionCode < 1 || versionCode > 2100000000L || bytes < 1 || bytes > 200L * 1024 * 1024 || !sha256.matches("[a-f0-9]{64}")) throw new IOException("更新信息无效");
        }
        JSONObject json() throws Exception { return new JSONObject().put("version", version).put("versionCode", versionCode).put("bytes", bytes).put("sha256", sha256); }
    }
    private File directory() { return new File(getContext().getFilesDir(), "updates"); }
    private File apk() { return new File(directory(), "verified.apk"); }
    private File part() { return new File(directory(), "download.part"); }
    private File metadata() { return new File(directory(), "ready.json"); }
    private void status(String next, String text) { synchronized(lock) { phase = next; message = text; revision++; } }
    private long code(PackageInfo info) { return Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode; }
    private int signatureFlags() { return Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES; }
    private Signature[] signers(PackageInfo info) { return Build.VERSION.SDK_INT >= 28 ? info.signingInfo == null ? null : info.signingInfo.getApkContentsSigners() : info.signatures; }
    private boolean signedByExpected(PackageInfo info) throws Exception {
        Signature[] values = signers(info);
        return values != null && values.length == 1 && ApkTransfer.hex(MessageDigest.getInstance("SHA-256").digest(values[0].toByteArray())).equals(SIGNER);
    }
    private void verify(File file, Spec spec) throws Exception {
        if (!file.isFile() || file.length() != spec.bytes || !ApkTransfer.hash(file).equals(spec.sha256)) throw new IOException("安装包校验失败，请重新下载");
        PackageManager pm = getContext().getPackageManager();
        PackageInfo archive = pm.getPackageArchiveInfo(file.getAbsolutePath(), signatureFlags());
        PackageInfo installed = pm.getPackageInfo(APP_ID, signatureFlags());
        if (archive == null || !APP_ID.equals(archive.packageName) || code(archive) != spec.versionCode || !spec.version.equals(archive.versionName)) throw new IOException("安装包的应用身份或版本不匹配");
        if (code(archive) <= code(installed)) throw new IOException("该版本已安装或低于当前版本，请重新检查更新");
        if (archive.applicationInfo == null || archive.applicationInfo.minSdkVersion > Build.VERSION.SDK_INT) throw new IOException("新版不支持当前 Android 系统");
        if (!signedByExpected(archive) || !signedByExpected(installed)) throw new IOException("安装包签名与当前应用不一致，已拒绝安装");
    }
    @Override public void load() {
        worker.execute(() -> {
            try {
                directory().mkdirs();
                boolean interrupted = part().exists(); part().delete();
                if (metadata().isFile() && metadata().length() < 4096 && apk().isFile()) {
                    String text;
                    try (InputStream input = new FileInputStream(metadata())) { byte[] bytes = new byte[(int)metadata().length()]; new DataInputStream(input).readFully(bytes); text = new String(bytes, StandardCharsets.UTF_8); }
                    Spec saved = new Spec(new JSONObject(text));
                    if (saved.versionCode <= code(getContext().getPackageManager().getPackageInfo(APP_ID, 0))) { metadata().delete(); apk().delete(); status("idle", ""); return; }
                    verify(apk(), saved);
                    synchronized(lock) { target = saved; received = saved.bytes; }
                    status("ready", "安装包已下载并校验，可继续安装");
                } else { apk().delete(); metadata().delete(); status("idle", interrupted ? "上次下载中断，请重新下载" : ""); }
            } catch (Exception e) { apk().delete(); metadata().delete(); status("error", "之前的安装包未通过校验，请重新下载"); }
        });
    }
    @PluginMethod public void getState(PluginCall call) {
        JSObject value = new JSObject();
        synchronized(lock) {
            value.put("phase", phase); value.put("message", message); value.put("received", received); value.put("revision", revision);
            value.put("version", target == null ? "" : target.version); value.put("total", target == null ? 0 : target.bytes);
        }
        call.resolve(value);
    }
    @PluginMethod public void start(PluginCall call) {
        final Spec spec;
        try { spec = new Spec(call.getData()); if (spec.versionCode <= code(getContext().getPackageManager().getPackageInfo(APP_ID, 0))) throw new IOException("请先检查更新，不能下载旧版本"); }
        catch (Exception e) { call.reject(e.getMessage()); return; }
        final ApkTransfer.Stop job = new ApkTransfer.Stop();
        synchronized(lock) {
            if (active != null || installing || "restoring".equals(phase)) { call.reject("请先完成或取消当前操作"); return; }
            active = job; target = spec; received = 0; status("connecting", "正在连接 GitHub 下载服务…");
        }
        worker.execute(() -> {
            ScheduledFuture<?> timeout = watchdog.schedule(() -> job.cancel("下载超过 3 分钟，请检查网络后重试"), 180, TimeUnit.SECONDS);
            try {
                if (!directory().isDirectory() && !directory().mkdirs()) throw new IOException("无法创建安装包存储目录");
                metadata().delete(); apk().delete(); part().delete();
                if (directory().getUsableSpace() < spec.bytes + 10L * 1024 * 1024) throw new IOException("手机存储空间不足，请清理后重试");
                ApkTransfer.transfer(ApkTransfer.downloadUrl(spec.version), spec.bytes, spec.sha256, part(), job, count -> {
                    synchronized(lock) { if (job.stopped.get()) return; received = count; status("downloading", "正在下载安装包…"); }
                }, url -> (HttpURLConnection) url.openConnection());
                job.check(); status("verifying", "下载完成，正在校验大小、摘要和签名…");
                verify(part(), spec); job.check();
                synchronized(lock) {
                    job.check();
                    if (!part().renameTo(apk())) throw new IOException("无法保存已校验的安装包，请重试");
                    try (FileOutputStream output = new FileOutputStream(metadata())) { output.write(spec.json().toString().getBytes(StandardCharsets.UTF_8)); output.getFD().sync(); }
                    status("ready", "校验通过，安装包已保存在 App 中");
                }
            } catch (Exception e) {
                part().delete(); apk().delete(); metadata().delete();
                status(job.stopped.get() && "下载已取消".equals(job.reason) ? "cancelled" : "error", job.stopped.get() ? job.reason : e.getMessage() == null ? "下载失败，请检查网络后重试" : e.getMessage());
            } finally { timeout.cancel(false); synchronized(lock) { active = null; } }
        });
        call.resolve();
    }
    @PluginMethod public void cancel(PluginCall call) {
        synchronized(lock) {
            if (active != null && !"ready".equals(phase)) {
                ApkTransfer.Stop job = active; job.reason = "下载已取消"; job.stopped.set(true);
                status("cancelling", "正在取消下载…");
                watchdog.execute(() -> job.cancel("下载已取消"));
            }
        }
        call.resolve();
    }
    @PluginMethod public void install(PluginCall call) {
        final Spec spec;
        synchronized(lock) {
            if (!"ready".equals(phase) || target == null || active != null || installing) { call.reject("安装包尚未校验完成"); return; }
            installing = true; spec = target;
        }
        worker.execute(() -> {
            try {
                verify(apk(), spec);
                if (Build.VERSION.SDK_INT >= 26 && !getContext().getPackageManager().canRequestPackageInstalls()) {
                    JSObject result = new JSObject(); result.put("needsPermission", true); call.resolve(result); return;
                }
                Uri uri = FileProvider.getUriForFile(getContext(), APP_ID + ".fileprovider", apk());
                Intent intent = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive");
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
                JSObject result = new JSObject(); result.put("needsPermission", false); call.resolve(result);
            } catch (Exception e) { call.reject(e.getMessage() == null ? "无法打开系统安装器，可使用备用 ZIP 手动安装" : e.getMessage()); }
            finally { synchronized(lock) { installing = false; } }
        });
    }
    @PluginMethod public void openInstallSettings(PluginCall call) {
        try {
            if (Build.VERSION.SDK_INT >= 26) getContext().startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + APP_ID)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            call.resolve();
        } catch (Exception e) { call.reject("无法打开安装授权页面，请在系统设置中为知衡允许安装应用"); }
    }
    @Override protected void handleOnDestroy() {
        synchronized(lock) { if (active != null) { ApkTransfer.Stop job = active; watchdog.execute(() -> job.cancel("下载已中断，请重新下载")); } }
        worker.shutdown(); watchdog.shutdown();
    }
}
