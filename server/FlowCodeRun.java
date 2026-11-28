package com.horsecoder.common.whuTalent.core.flow.Run.code;

import cc.eamon.open.flow.core.FlowEngine;
import cc.eamon.open.flow.core.stereotype.Flow;
import cc.eamon.open.flow.spring.FlowComponent;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * 覆盖平台自带的 FLOW_CODE_RUN 节点实现。
 *
 * 平台原来的 flowCodeRun 是个 TODO 空壳（注册 null），这里把它换成：
 *   把 structure 当成 caseId，交给本地 Node worker 执行，
 *   拿回的 JSON 写回引擎的 result。
 *
 * 这样流程定义、调度、结果回填仍在 Java 引擎里完成，
 * 切块/检索/模型调用复用已验证的 TypeScript 管线。
 */
@FlowComponent
public class FlowCodeRun {

    private static final String WORKER =
            System.getProperty("case.worker", "http://127.0.0.1:39100/execute");

    /**
     * 运行
     * FLOW_CODE_RUN
     *
     * @param structure 案例编号（如 IB-06）
     * @result result 运行结果（JSON）
     */
    @Flow("FLOW_CODE_RUN")
    public void flowCodeRun(String structure) {
        String result;
        try {
            result = post("{\"caseId\":\"" + structure + "\"}");
        } catch (Exception e) {
            result = "{\"caseId\":\"" + structure + "\",\"error\":\"" + e.getClass().getSimpleName() + "\"}";
        }
        FlowEngine.instance().register("result", result);
    }

    private String post(String body) throws Exception {
        URL url = new URL(WORKER);
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setRequestMethod("POST");
        conn.setRequestProperty("Content-Type", "application/json;charset=UTF-8");
        conn.setConnectTimeout(5000);
        conn.setReadTimeout(180000);
        conn.setDoOutput(true);
        try (OutputStream os = conn.getOutputStream()) {
            os.write(body.getBytes("UTF-8"));
        }
        int code = conn.getResponseCode();
        InputStream is = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while (is != null && (n = is.read(buf)) > 0) {
            bos.write(buf, 0, n);
        }
        String text = new String(bos.toByteArray(), "UTF-8");
        if (code >= 400) throw new IllegalStateException("worker HTTP " + code);
        return text;
    }
}
