// 출력 양식(로고/회사 정보/제목/사진 채움/직인) — 서버(DB)에 저장된 공유 설정을 PDM_LAYOUT 에 반영한다.
// 서버가 이미지를 null 로 주면 이 파일의 내장 기본 이미지(PDM_LOGO, PDM_SEAL)를 쓴다.
// 의존: print_assets.js(PDM_LOGO, PDM_SEAL), eel
const PDM_LAYOUT = {
    logo: PDM_LOGO,
    company: 'SUNJIN JONGHAP Co.,Ltd.',
    address: '#3, 41 Daepyoeng ro, Yeongdo-gu, Busan,',
    tel: '+82 51 414 7300',
    fax: '+82 51 414 8870',
    srTitle: 'Service report',
    photoFit: 'cover',     // 'cover' = 사진칸을 꽉 채움(원본 양식과 동일, 가장자리는 잘림) / 'contain' = 사진 전체를 여백 포함해 맞춤
    seal: { enabled: false, image: PDM_SEAL, x: 84.4, y: 231.9, w: 38.2 },   // 서비스레포트 사진 페이지에 찍는 직인 (mm)
};

const PdmLayout = (() => {
    // 서버 값(이미지는 null 가능) → 화면에서 바로 쓰는 값 (null 이미지는 내장 기본 이미지로)
    const toEffective = raw => ({
        ...raw,
        logo: raw.logo || PDM_LOGO,
        seal: { ...raw.seal, image: raw.seal.image || PDM_SEAL },
    });

    // 서버의 최신 설정을 PDM_LAYOUT 에 반영. 반환: 서버 원본 값(편집 화면용, 이미지 null 유지)
    async function load() {
        const r = await eel.pdm_get_layout()();
        if (!r.success) return null;
        Object.assign(PDM_LAYOUT, toEffective(r.layout));
        return r.layout;
    }

    async function save(raw) {
        const r = await eel.pdm_save_layout(raw)();
        if (r.success) Object.assign(PDM_LAYOUT, toEffective(r.layout));
        return r;
    }

    return { load, save, defaults: { logo: PDM_LOGO, seal: PDM_SEAL } };
})();
