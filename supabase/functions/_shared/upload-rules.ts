export const uploadLimitBytes = 50_000_000;
export const uploadExtensions = [".txt", ".md", ".pdf", ".docx", ".pptx", ".xlsx", ".jpg", ".jpeg", ".png"];
const videoExtension = /\.(?:3g2|3gp|avi|flv|m2ts|m4v|mkv|mov|mp4|mpeg|mpg|mts|ogv|ts|webm|wmv)$/i;

export function unsupportedUploadReason(name: string, contentType = ""): string | null {
  const normalized = name.trim().toLowerCase();
  if (videoExtension.test(normalized) || /^video\//i.test(contentType.trim())) {
    return "동영상은 업로드할 수 없습니다.";
  }
  if (normalized.endsWith(".ppt")) {
    return "PowerPoint에서 ‘다른 이름으로 저장’을 선택해 .pptx로 바꾼 뒤 다시 올려 주세요.";
  }
  const extension = normalized.slice(normalized.lastIndexOf("."));
  if (!uploadExtensions.includes(extension)) {
    return "지원하지 않는 파일 형식입니다. TXT, MD, PDF, DOCX, PPTX, XLSX, JPG, JPEG, PNG만 올릴 수 있습니다.";
  }
  return null;
}

export function uploadSizeReason(size: number): string | null {
  if (size >= uploadLimitBytes) {
    return "50 MB 미만만 업로드할 수 있습니다. 이미지는 압축하고 문서는 필요한 부분을 나눠 다시 선택해 주세요.";
  }
  return null;
}
