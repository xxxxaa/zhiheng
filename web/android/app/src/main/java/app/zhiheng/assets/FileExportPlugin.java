package app.zhiheng.assets;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/** Saves an encrypted backup or CSV through Android's system document picker. */
@CapacitorPlugin(name = "FileExport")
public class FileExportPlugin extends Plugin {
    private volatile boolean exporting;

    @PluginMethod
    public void saveFile(PluginCall call) {
        String name = call.getString("name");
        String data = call.getString("data");
        if (name == null || data == null || !(name.endsWith(".csv") || name.endsWith(".zhb"))) {
            call.reject("文件名称或内容无效");
            return;
        }
        if (data.getBytes(StandardCharsets.UTF_8).length > 30 * 1024 * 1024) {
            call.reject("文件不能超过 30 MB");
            return;
        }
        if (exporting) {
            call.reject("请先完成当前文件保存");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(name.endsWith(".csv") ? "text/csv" : "application/octet-stream");
        intent.putExtra(Intent.EXTRA_TITLE, name.replace('/', '_').replace('\\', '_'));
        exporting = true;
        try {
            startActivityForResult(call, intent, "documentCreated");
        } catch (Exception error) {
            exporting = false;
            call.reject("无法打开系统文件保存窗口", error);
        }
    }

    @ActivityCallback
    private void documentCreated(PluginCall call, ActivityResult result) {
        if (call == null) { exporting = false; return; }
        Uri uri = result.getData() == null ? null : result.getData().getData();
        if (result.getResultCode() != Activity.RESULT_OK || uri == null) {
            exporting = false;
            JSObject response = new JSObject();
            response.put("saved", false);
            call.resolve(response);
            return;
        }
        execute(() -> {
            try (OutputStream stream = getContext().getContentResolver().openOutputStream(uri, "wt")) {
                if (stream == null) throw new IllegalStateException("文件位置不可写");
                stream.write(call.getString("data", "").getBytes(StandardCharsets.UTF_8));
                stream.flush();
            } catch (Exception error) {
                exporting = false;
                call.reject("文件未保存完成，请检查存储空间或更换保存位置", error);
                return;
            }
            exporting = false;
            JSObject response = new JSObject();
            response.put("saved", true);
            call.resolve(response);
        });
    }
}
