export const DEFAULT_PROJECT_ID = "project_default";

export const WORKFLOWS = [
  { id: "single-image", label: "이미지", title: "단일 이미지", description: "프롬프트로 캠페인/시안 이미지를 생성합니다." },
  { id: "sprite-sheet", label: "2D 스프라이트", title: "2D 스프라이트", description: "방향과 동작 행을 가진 스프라이트 시트를 만듭니다." },
  { id: "3d-production-sheet", label: "3D 레퍼런스", title: "3D 제작 시트", description: "모델링 핸드오프용 턴어라운드 레퍼런스를 만듭니다." },
  { id: "3d-mesh-export", label: "3D 파일", title: "OBJ/MTL export", description: "절차형 3D 메시 파일을 바로 내보냅니다." },
  { id: "kakao-emoticon-static", label: "정적 이모티콘", title: "카카오 정적 32종", description: "32개 정적 이모티콘 PNG 세트를 만듭니다." },
  { id: "kakao-emoticon-gif", label: "컷툰/GIF", title: "컷툰·GIF", description: "컷 단위 이미지와 GIF/영상 결과물을 만듭니다." },
  { id: "region-edit", label: "영역 편집", title: "영역 편집", description: "가져온 이미지나 결과 이미지의 선택 영역만 편집합니다." }
 ];

export const ASSET_MODE_OPTIONS = WORKFLOWS.map((item) => [item.id, item.title]);

export function projectLabel(type) {
  return WORKFLOWS.find((item) => item.id === type)?.label || "알 수 없는 모드";
}
