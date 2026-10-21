package app.zhiheng.assets;

import org.junit.Test;
import org.junit.Rule;
import org.junit.rules.TemporaryFolder;
import static org.junit.Assert.*;
import java.io.*;
import java.net.*;
import java.security.MessageDigest;
import java.util.*;

public class ApkTransferTest {
    @Rule public TemporaryFolder temporary = new TemporaryFolder();
    private final byte[] payload = "synthetic apk fixture".getBytes(java.nio.charset.StandardCharsets.UTF_8);
    private String hash() throws Exception { return ApkTransfer.hex(MessageDigest.getInstance("SHA-256").digest(payload)); }
    private static class Response extends HttpURLConnection {
        int status=200; long length; String location; InputStream input; boolean disconnected;
        Response(byte[] bytes) throws Exception { super(new URL("https://github.com")); length=bytes.length; input=new ByteArrayInputStream(bytes); }
        public int getResponseCode(){return status;}
        public long getContentLengthLong(){return length;}
        public String getHeaderField(String name){return "Location".equals(name)?location:null;}
        public InputStream getInputStream(){return input;}
        public void disconnect(){disconnected=true;}
        public boolean usingProxy(){return false;}
        public void connect(){}
    }
    private void transfer(File file, ApkTransfer.Stop stop, ApkTransfer.Progress progress, ApkTransfer.Connector connector) throws Exception {
        ApkTransfer.transfer(ApkTransfer.downloadUrl("0.1.5"),payload.length,hash(),file,stop,progress,connector);
    }
    @Test public void completesAtExactVerifiedLengthWithoutWaitingForEof() throws Exception {
        File file=temporary.newFile();Response response=new Response(payload);
        response.input=new ByteArrayInputStream(payload){@Override public synchronized int read(byte[] b,int off,int len){if(available()==0)throw new AssertionError("Do not wait for EOF after exact length");return super.read(b,off,len);}};
        List<Long> progress=new ArrayList<>();transfer(file,new ApkTransfer.Stop(),progress::add,url->response);
        assertEquals(hash(),ApkTransfer.hash(file));assertEquals(Long.valueOf(payload.length),progress.get(progress.size()-1));assertTrue(response.disconnected);
        assertEquals(15000,response.getReadTimeout());assertEquals(15000,response.getConnectTimeout());assertFalse(response.getInstanceFollowRedirects());
    }
    @Test public void followsOnlyGithubAssetRedirects() throws Exception {
        Response redirect=new Response(payload);redirect.status=302;redirect.location="https://release-assets.githubusercontent.com/test?signature=public";
        Response data=new Response(payload);List<URL> urls=new ArrayList<>();File file=temporary.newFile();
        transfer(file,new ApkTransfer.Stop(),n->{},url->{urls.add(url);return urls.size()==1?redirect:data;});
        assertEquals(2,urls.size());assertTrue(redirect.disconnected);assertEquals(hash(),ApkTransfer.hash(file));
    }
    @Test public void rejectsUntrustedRedirectsBeforeConnecting() throws Exception {
        for(String location:Arrays.asList("http://release-assets.githubusercontent.com/x","https://evil.example/x","https://github.com/attacker/other","https://user:pass@objects.githubusercontent.com/x","https://objects.githubusercontent.com:444/x")){
            Response response=new Response(payload);response.status=302;response.location=location;File file=temporary.newFile();int[] calls={0};
            try{transfer(file,new ApkTransfer.Stop(),n->{},url->{calls[0]++;return response;});fail("must reject "+location);}catch(IOException expected){}
            assertEquals(1,calls[0]);assertFalse(file.exists());
        }
    }
    @Test public void rejectsRedirectLoops() throws Exception {
        Response response=new Response(payload);response.status=302;response.location=ApkTransfer.downloadUrl("0.1.5");int[] calls={0};File file=temporary.newFile();
        try{transfer(file,new ApkTransfer.Stop(),n->{},url->{calls[0]++;return response;});fail();}catch(IOException expected){assertTrue(expected.getMessage().contains("跳转过多"));}
        assertEquals(6,calls[0]);assertFalse(file.exists());
    }
    @Test public void rejectsTruncatedAndMismatchedBodiesAndDeletesPartial() throws Exception {
        for(int variant=0;variant<3;variant++){
            Response response=new Response(payload);File file=temporary.newFile();
            if(variant==0)response.length++;
            if(variant==1){response.length=-1;response.input=new ByteArrayInputStream(new byte[2]);}
            if(variant==2)response.input=new ByteArrayInputStream(new byte[payload.length]);
            try{transfer(file,new ApkTransfer.Stop(),n->{},url->response);fail();}catch(IOException expected){}
            assertFalse(file.exists());
        }
    }
    @Test public void handlesTimeoutAndHttpErrors() throws Exception {
        Response stalled=new Response(payload);stalled.input=new InputStream(){public int read() throws IOException{throw new SocketTimeoutException();}};
        File file=temporary.newFile();try{transfer(file,new ApkTransfer.Stop(),n->{},url->stalled);fail();}catch(IOException expected){assertTrue(expected.getMessage().contains("15 秒"));}
        assertFalse(file.exists());
        Response unavailable=new Response(payload);unavailable.status=503;
        try{transfer(file,new ApkTransfer.Stop(),n->{},url->unavailable);fail();}catch(IOException expected){assertTrue(expected.getMessage().contains("503"));}
    }
    @Test public void cancellationStopsTransferAndAllowsFreshRetry() throws Exception {
        File file=temporary.newFile();Response response=new Response(payload);ApkTransfer.Stop stop=new ApkTransfer.Stop();
        try{transfer(file,stop,n->stop.cancel("下载已取消"),url->response);fail();}catch(IOException expected){assertEquals("下载已取消",expected.getMessage());}
        assertFalse(file.exists());assertTrue(response.disconnected);
        Response retry=new Response(payload);transfer(file,new ApkTransfer.Stop(),n->{},url->retry);assertEquals(hash(),ApkTransfer.hash(file));
    }
    @Test public void refusesInvalidVersionsAndMetadata() throws Exception {
        try{ApkTransfer.downloadUrl("../../evil");fail();}catch(IllegalArgumentException expected){}
        File file=temporary.newFile();
        try{ApkTransfer.transfer(ApkTransfer.downloadUrl("0.1.5"),201L*1024*1024,hash(),file,new ApkTransfer.Stop(),n->{},url->{throw new AssertionError();});fail();}catch(IOException expected){}
    }
}
