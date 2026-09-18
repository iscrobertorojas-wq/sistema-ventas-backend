const fs = require('fs');
const path = require('path');

const targetFile = path.join(__dirname, '../node_modules/@nodecfdi/sat-ws-descarga-masiva/build/index.js');

if (fs.existsSync(targetFile)) {
    let content = fs.readFileSync(targetFile, 'utf-8');
    let changed = false;

    // Patch 1: Safe getResponse in execute
    if (content.includes('response = webError.getResponse();')) {
        content = content.replace(
            'response = webError.getResponse();',
            'response = typeof webError?.getResponse === "function" ? webError.getResponse() : new CResponse(0, webError?.message || "Error de red con el SAT", {});'
        );
        changed = true;
    }

    // Patch 2: Safe fireResponse in runRequest
    if (content.includes('webClient.fireResponse(webError.getResponse());')) {
        content = content.replace(
            'webClient.fireResponse(webError.getResponse());',
            'if (typeof webError?.getResponse === "function") { webClient.fireResponse(webError.getResponse()); }'
        );
        changed = true;
    }

    // Patch 3: WebClientException on timeout
    if (content.includes('this._timeout === void 0 ? new Error("Request time out") : new WebClientException')) {
        content = content.replace(
            'this._timeout === void 0 ? new Error("Request time out") : new WebClientException("Request time out", request, CResponse.timeout(this._timeout))',
            'new WebClientException("Request time out", request, CResponse.timeout(this._timeout ?? 60000))'
        );
        changed = true;
    }

    if (changed) {
        fs.writeFileSync(targetFile, content, 'utf-8');
        console.log('[Patch SAT Library] Librería @nodecfdi/sat-ws-descarga-masiva parchada exitosamente.');
    } else {
        console.log('[Patch SAT Library] La librería ya se encuentra parchada.');
    }
} else {
    console.log('[Patch SAT Library] Archivo no encontrado, saltando parche.');
}
