import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages 에 올릴 때는 base 가 저장소 이름과 같아야 한다.
// 예) https://<계정>.github.io/munseong-choice/ 로 쓴다면 base: '/munseong-choice/'
// 저장소 이름을 바꾸면 여기도 같이 바꾼다.
export default defineConfig({
  plugins: [react()],
  base: process.env.BASE_PATH || '/munseong-choice/',
})
