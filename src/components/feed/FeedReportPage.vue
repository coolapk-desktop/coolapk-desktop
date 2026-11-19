<template>
  <section class="feed-report-page custom-scrollbar">
    <header class="report-header"><button aria-label="返回" @click="goBack"><i class="fas fa-arrow-left"></i></button><h1>举报{{ report?.type === 'reply' ? '回复' : '动态' }}</h1></header>
    <div v-if="loading" class="report-state"><LoadingState text="正在加载举报表单…" /></div>
    <div v-else-if="loadError" class="report-state"><ErrorState :message="loadError" @retry="load" /></div>
    <template v-else-if="report">
      <h2 class="report-section-title">举报{{ report.type === 'reply' ? '回复' : '动态' }}</h2>
      <div class="report-target">
        <div class="report-author"><AppAvatar :src="report.avatar" :size="28" /><span>{{ report.author }}</span></div>
        <div class="report-content" v-html="report.content" @click="handleAnchorClick"></div>
      </div>
      <form @submit.prevent="submit">
        <h2 class="report-section-title">举报原因</h2>
        <fieldset :disabled="submitting || submitted" class="report-reasons">
          <label v-for="item in report.reasons" :key="item" class="report-reason">
            <input v-model="reason" type="radio" name="report_reason" :value="item" />
            <input v-if="item === '其他'" v-model="customReason" name="custom_report_reason" class="report-custom-reason" placeholder="请输入自定义举报原因" maxlength="1000" @focus="reason = item" />
            <span v-else>{{ item }}</span>
          </label>
        </fieldset>
        <h2 class="report-section-title">图片</h2>
        <div class="report-pictures">
          <div v-for="(picture, index) in pictures" :key="picture.preview" class="report-picture"><img :src="picture.preview" alt="举报附件" /><button v-if="!submitting && !submitted" type="button" aria-label="移除图片" @click="removePicture(index)">×</button></div>
          <label v-if="pictures.length < 9 && !submitted" class="report-add-picture"><span>+</span><input type="file" accept="image/*" multiple :disabled="submitting" aria-label="添加举报图片" @change="addPictures" /></label>
        </div>
        <p v-if="submitError" class="report-error" role="alert">{{ submitError }}</p>
        <p v-if="submitted" class="report-success" role="status">{{ successMessage }}</p>
        <div class="report-submit-area"><AppButton class="report-submit" type="submit" :loading="submitting" :disabled="submitted || !reason || (reason === '其他' && !customReason.trim())">{{ submitted ? '已提交' : '提交' }}</AppButton></div>
      </form>
    </template>
  </section>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue';
import { useRouter } from 'vue-router';
import { CoolapkTauriAPI } from '../../api/coolapk';
import { parseFeedReport } from '../../utils/feedReport';
import { navigateBack } from '../../utils/navigation';
import { handleAnchorClick } from '../../utils/anchorClick';
import AppAvatar from '../common/AppAvatar.vue';
import AppButton from '../common/AppButton.vue';
import LoadingState from '../common/LoadingState.vue';
import ErrorState from '../common/ErrorState.vue';
const props = defineProps<{ url: string }>();
const router = useRouter();
const report = ref<ReturnType<typeof parseFeedReport> | null>(null);
const loading = ref(false), loadError = ref(''), reason = ref(''), customReason = ref('');
const submitting = ref(false), submitted = ref(false), submitError = ref(''), successMessage = ref('');
const pictures = ref<Array<{ file: File; preview: string; uploaded?: string }>>([]);
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);
function goBack() { navigateBack(router); }
async function load() {
  loading.value = true; loadError.value = '';
  try {
    const response: any = await CoolapkTauriAPI.fetchExternalPage(props.url);
    if (response?.data?.status >= 400) throw new Error(`页面返回 HTTP ${response.data.status}`);
    report.value = parseFeedReport(response?.data?.html || '', props.url);
  } catch (error) { loadError.value = errorMessage(error); }
  finally { loading.value = false; }
}
function addPictures(event: Event) {
  const input = event.target as HTMLInputElement;
  for (const file of Array.from(input.files || [])) {
    if (pictures.value.length >= 9) { submitError.value = '最多添加 9 张图片'; break; }
    if (!file.type.startsWith('image/')) { submitError.value = '请选择图片文件'; continue; }
    pictures.value.push({ file, preview: URL.createObjectURL(file) });
  }
  input.value = '';
}
function removePicture(index: number) { URL.revokeObjectURL(pictures.value[index]!.preview); pictures.value.splice(index, 1); }
async function submit() {
  if (!report.value || submitting.value || submitted.value || !reason.value || (reason.value === '其他' && !customReason.value.trim())) return;
  submitting.value = true; submitError.value = '';
  try {
    for (const picture of pictures.value) {
      if (picture.uploaded) continue;
      const uploaded: any = await CoolapkTauriAPI.uploadImage(new Uint8Array(await picture.file.arrayBuffer()), picture.file.name, picture.file.type, 'feed_report');
      const url = typeof uploaded === 'string' ? uploaded : uploaded?.url || uploaded?.data?.url || (typeof uploaded?.data === 'string' ? uploaded.data : '');
      if (!url) throw new Error('举报图片上传失败，请重试');
      picture.uploaded = url;
    }
    const response: any = await CoolapkTauriAPI.submitFeedReport(report.value.id, report.value.type, reason.value, customReason.value.trim(), report.value.requestHash, pictures.value.map(item => item.uploaded!));
    const result = response?.data ?? response;
    const status = result?.status == null ? null : Number(result.status);
    if ((status !== null && ![1, 200].includes(status)) || (result?.code != null && ![0, 1, 200].includes(Number(result.code)))) throw new Error(result?.message || '举报提交失败');
    if (!result || (result.status == null && result.code == null && !result.message)) throw new Error('举报服务返回异常');
    submitted.value = true; successMessage.value = result.message || '举报已提交';
  } catch (error) { submitError.value = errorMessage(error); }
  finally { submitting.value = false; }
}
onBeforeUnmount(() => pictures.value.forEach(picture => URL.revokeObjectURL(picture.preview)));
void load();
</script>

<style scoped>
.feed-report-page{height:100%;overflow-y:auto;background:var(--surface);color:var(--text-primary);max-width:900px;margin:auto;padding-bottom:calc(24px + env(safe-area-inset-bottom))}
.report-header{display:flex;align-items:center;gap:20px;position:sticky;top:0;background:var(--surface);z-index:2;padding:14px 20px;border-bottom:1px solid var(--border)}
.report-header h1{font-size:20px;font-weight:500;margin:0}.report-header button{background:none;border:0;color:inherit;font-size:20px;padding:4px}
.report-section-title{margin:0;padding:20px 16px 8px;background:var(--background-secondary);color:var(--text-secondary);font-size:14px;font-weight:400;border-bottom:1px solid var(--border)}
.report-author{display:flex;align-items:center;gap:6px;padding:16px;border-bottom:1px solid var(--border);font-size:18px}
.report-content{padding:16px 16px 20px 46px;font-size:17px;line-height:1.6;overflow-wrap:anywhere}.report-content :deep(a){color:var(--brand-primary)}
.report-reasons{border:0;margin:0;padding:0}.report-reason{display:flex;align-items:center;gap:18px;padding:17px 16px;min-height:56px;cursor:pointer;position:relative;font-size:16px;line-height:1.5}
.report-reason::after{content:'';position:absolute;bottom:0;left:56px;right:0;border-bottom:1px solid var(--border)}
.report-reason input[type=radio]{appearance:none;width:21px;height:21px;border:1.5px solid var(--text-tertiary);border-radius:50%;flex-shrink:0;margin:0;display:grid;place-content:center}
.report-reason input[type=radio]:checked{border-color:var(--brand-primary)}.report-reason input[type=radio]:checked::after{content:'';width:11px;height:11px;border-radius:50%;background:var(--brand-primary)}
.report-custom-reason{background:none;border:0;outline:0;color:inherit;font:inherit;min-width:0;width:100%}
.report-pictures{display:flex;flex-wrap:wrap;gap:10px;padding:16px}.report-picture,.report-add-picture{position:relative;width:64px;height:64px}.report-picture img{width:100%;height:100%;object-fit:cover;border-radius:4px}.report-picture button{position:absolute;right:0;top:0;background:#0009;color:white;border:0;font-size:18px}
.report-add-picture{border:1px solid var(--border);display:grid;place-items:center;font-size:32px;color:var(--text-tertiary)}.report-add-picture input{position:absolute;inset:0;opacity:0;width:100%;cursor:pointer}
.report-submit-area{padding:12px 16px 24px}.report-submit{width:100%;font-size:17px}.report-error,.report-success{padding:0 16px;font-size:14px}.report-error{color:var(--danger)}.report-success{color:var(--brand-primary)}.report-state{padding:32px 16px}
@media(min-width:721px){.feed-report-page{border:1px solid var(--border)}.report-header{padding:18px 28px}.report-content{padding-left:62px}.report-submit-area{max-width:420px;margin:auto}}
</style>
