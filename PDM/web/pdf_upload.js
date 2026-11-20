// 기존 PDF 업로드 — 이 앱이 만든 서비스레포트/부품사진첩 PDF 를 읽어 선택한 주문의 새 문서(작성자 전용 임시)로 만든다.
//   읽기에 실패하면 이유를 보여 주고, 사용자가 [관리자에게 보내기]를 누르면 오류 내용과 PDF 를 관리자에게 텔레그램으로 보낸다
//   (고객 문서가 외부 서비스로 나가므로 팝업에 안내하고, 누르지 않으면 아무것도 보내지 않는다).
// 의존: dom.js(h, showChoice, blobToDataURL, DOC_LABEL), eel
const PdfUpload = (() => {
    const MAX_BYTES = 30 * 1024 * 1024;

    // options: {docType, contractNumber, say(text, bad), onCreated(document)}  — 파일 선택창을 열고 끝까지 처리한다
    function pick(options) {
        const input = h('input', { type: 'file', accept: 'application/pdf,.pdf', class: 'hidden' });
        input.addEventListener('change', () => { const file = input.files[0]; input.remove(); if (file) run(file, options); });
        document.body.append(input);
        input.click();
    }

    async function run(file, { docType, contractNumber, say, onCreated }) {
        if (!/\.pdf$/i.test(file.name)) { say('PDF 파일(.pdf)만 올릴 수 있습니다.', true); return; }
        if (file.size > MAX_BYTES) { say('파일이 너무 큽니다 (최대 30MB).', true); return; }
        say('PDF 를 읽는 중… (사진이 많으면 시간이 걸립니다)');
        let data;
        try { data = (await blobToDataURL(file)).split(',')[1] || ''; } catch (e) { say('파일을 읽지 못했습니다.', true); return; }
        let r;
        try { r = await eel.pdm_import_pdf(docType, contractNumber, file.name, data)(); } catch (e) { r = { success: false, message: '서버와 통신하지 못했습니다.' }; }
        if (r.success) {
            say(`PDF 를 읽어 새 문서를 만들었습니다 (사진 ${r.photoCount}장${r.skippedPhotos ? `, 읽지 못한 사진 ${r.skippedPhotos}장` : ''}). 내용을 확인하고 저장하세요.`);
            onCreated(r.document);
            return;
        }
        say(r.message, true);
        if (r.recognitionError) await offerReport({ docType, contractNumber, file, data, message: r.message, say });
    }

    // 오류 보고 팝업 — 사용자가 [보내기]를 눌러야만 전송한다
    async function offerReport({ docType, contractNumber, file, data, message, say }) {
        const label = DOC_LABEL[docType] || docType;
        const choice = await showChoice('PDF 를 읽지 못했습니다',
            `${message}\n\n오류 내용과 이 PDF 파일("${file.name}")을 관리자에게 텔레그램으로 보내면 읽을 수 있게 개선하는 데 쓰입니다. 고객 정보가 포함된 문서일 수 있으니 보내도 되는 경우에만 보내 주세요.`,
            [{ label: '관리자에게 보내기', value: true, primary: true }, { label: '보내지 않음', value: false }]);
        if (choice !== true) return;
        say('관리자에게 보내는 중…');
        let r;
        try { r = await eel.pdm_report_import_error(docType, contractNumber, file.name, data, `${label}: ${message}`)(); } catch (e) { r = { success: false, message: '서버와 통신하지 못했습니다.' }; }
        say(r.success ? '관리자에게 보냈습니다. 확인 후 개선하겠습니다.' : r.message, !r.success);
    }

    return { pick };
})();
