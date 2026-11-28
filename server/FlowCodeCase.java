package com.horsecoder.common.whuTalent.core.flow.caseexec;

import cc.eamon.open.flow.core.FlowEngine;
import cc.eamon.open.flow.core.stereotype.Flow;
import cc.eamon.open.flow.spring.FlowComponent;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * 案例执行节点：把 caseId 交给本地 Node worker，拿回结果 JSON 再回填引擎。
 *
 * 为什么这样分层：
 *   流程定义、调度、结果回填都在 Java 引擎里（后端确实是执行方）；
 *   切块 / 检索 / 模型调用 / 契约核验这些计算复用已验证的 TypeScript 管线，
 *   避免用 Java 重写一遍还要重新验证 30 条结果。
 */
@FlowComponent
public class FlowCodeCase {

    private static final String WORKER = System.getProperty("case.worker", "http://127.0.0.1:39100/execute");

    /**
     * 执行单个案例
     *
     * @param caseId 案例编号，如 IB-06
     * @result result 运行结果（JSON 字符串）
     */
    @Flow("FLOW_CODE_CASE")
    public void runCase(String caseId) {
        String result;
        try {
            result = post("{\"caseId\":\"" + caseId + "\"}");
        } catch (Exception e) {
            result = "{\"caseId\":\"" + caseId + "\",\"error\":\"" + e.getClass().getSimpleName() + "\"}";
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
        if (code >= 400) {
            throw new IllegalStateException("worker HTTP " + code + ": " + text);
        }
        return text;
    }
}
