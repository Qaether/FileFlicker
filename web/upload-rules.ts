export const uploadLimitBytes = 50_000_000;
const videoExtension = /\.(?:3g2|3gp|avi|flv|m2ts|m4v|mkv|mov|mp4|mpeg|mpg|mts|ogv|ts|webm|wmv)$/i;

export function exclusionReason(file: Pick<File, "name" | "type" | "size">): string | null {
  if (videoExtension.test(file.name.trim()) || /^video\//i.test(file.type)) {
    return "동영상은 업로드할 수 없습니다.";
  }
  if (file.size >= uploadLimitBytes) {
    return "50 MB 미만만 업로드할 수 있습니다. 이미지는 압축하고 문서는 필요한 부분을 나눠 다시 선택해 주세요.";
  }
  return null;
}
