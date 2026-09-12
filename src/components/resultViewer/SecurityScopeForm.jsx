import React, { useEffect, useState } from "react";

const CAPABILITIES = [
  ["login", "로그인"], ["password", "로컬 비밀번호 인증"], ["jwt", "JWT 사용"],
  ["rbac", "역할별 권한"], ["upload", "파일 업로드"], ["archive", "압축 해제"], ["webhook", "Webhook"],
];

export default function SecurityScopeForm({ result, onChange }) {
  const rtm = result?.pm_bundle?.plan?.requirements_rtm?.length ? result.pm_bundle.plan.requirements_rtm
    : result?.requirements_rtm?.length ? result.requirements_rtm : result?.pm_bundle?.data?.rtm || [];
  const features = [{ id: "__project__", desc: "프로젝트 공통 기능 / RTM에 없는 기능" },
    ...rtm.filter((r) => typeof r?.id === "string" && r.id !== "__project__")];
  const scopeKey = JSON.stringify([result?.run_id, features]);
  const [scope, setScope] = useState({});
  const [reviewed, setReviewed] = useState(false);
  useEffect(() => {
    const empty = Object.fromEntries(features.map((r) => [r.id, []]));
    setScope(empty); setReviewed(false);
    onChange({ scope: empty, reviewed: false, run_id: result?.run_id });
  }, [scopeKey, onChange]);
  const toggle = (id, capability, checked) => {
    const next = { ...scope, [id]: checked ? [...(scope[id] || []), capability] : (scope[id] || []).filter((v) => v !== capability) };
    setScope(next); setReviewed(false);
    onChange({ scope: next, reviewed: false, run_id: result?.run_id });
  };
  return <details className="border rounded-xl p-3" open={!reviewed}>
    <summary className="font-bold text-sm cursor-pointer">보안 적용 범위 확인 {reviewed ? "· 확인됨" : "· 생성 전 필수"}</summary>
    <p className="text-xs opacity-70 my-3">실제 요구사항을 기준으로 적용되는 항목을 선택하세요. 선택하지 않은 기능은 해당 없음으로 처리합니다. 모델의 설계 설명만으로 적용 여부를 결정하지 마세요.</p>
    <div className="max-h-72 overflow-auto space-y-3">
      {features.map((feature) => <fieldset key={feature.id} className="border rounded p-2">
        <legend className="text-xs font-bold">{feature.id === "__project__" ? "프로젝트 공통" : feature.id}</legend>
        <p className="text-xs whitespace-pre-wrap mb-2">{feature.desc || feature.description || feature.label}</p>
        <div className="flex flex-wrap gap-3">
          {CAPABILITIES.map(([id, label]) => <label key={id} className="text-xs flex gap-1 items-center">
            <input type="checkbox" checked={(scope[feature.id] || []).includes(id)} onChange={(e) => toggle(feature.id, id, e.target.checked)} />{label}
          </label>)}
        </div>
      </fieldset>)}
    </div>
    <label className="flex gap-2 items-center text-xs mt-3 font-semibold">
      <input type="checkbox" checked={reviewed} onChange={(e) => {
        setReviewed(e.target.checked); onChange({ scope, reviewed: e.target.checked, run_id: result?.run_id });
      }} />전체 기능과 프로젝트 공통 항목의 적용 여부를 확인했습니다.
    </label>
  </details>;
}
