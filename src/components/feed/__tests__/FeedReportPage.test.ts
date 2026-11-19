import { mount, flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isFeedReportUrl, parseFeedReport } from '../../../utils/feedReport';
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), submit: vi.fn(), upload: vi.fn() }));
vi.mock('../../../api/coolapk', () => ({ CoolapkTauriAPI: { fetchExternalPage: mocks.fetch, submitFeedReport: mocks.submit, uploadImage: mocks.upload } }));
vi.mock('vue-router', () => ({ useRouter: () => ({ back: vi.fn(), push: vi.fn() }) }));
vi.mock('../../../utils/anchorClick', () => ({ handleAnchorClick: vi.fn() }));
import FeedReportPage from '../FeedReportPage.vue';
const url = 'https://m.coolapk.com/mp/do?c=feed&m=report&type=feed&id=42';
const html = `<div class="weui-cell__group"><div class="weui-cells"><div class="weui-cell"><img src="https://avatar.coolapk.com/a.jpg"><div class="weui-cell__bd"><p>作者</p></div></div><div class="weui-cell"><div class="weui-cell__bd"><p>动态<a href="/t/手机">#手机#</a><script>evil()</script></p></div></div></div></div><form id="report" action="/mp/do?c=feed&m=report" method="post"><input name="id" value="42"><input name="type" value="feed"><input name="requestHash" value="test-token"><input type="radio" name="report_reason" value="小广告"><input type="radio" name="report_reason" value="其他"></form>`;
const mountPage = () => mount(FeedReportPage, { props: { url }, global: { stubs: { AppAvatar: true, LoadingState: true, ErrorState: { template: '<p>{{message}}</p>', props: ['message'] } } } });
describe('官方举报表单', () => {
  beforeEach(() => { mocks.fetch.mockReset().mockResolvedValue({ data: { html, status: 200 } }); mocks.submit.mockReset().mockResolvedValue({ code: 200, data: { status: 1, message: '举报成功' } }); mocks.upload.mockReset(); });
  it('只识别官方举报地址，拒绝第三方伪装、目标错配和跨域表单', () => {
    expect(isFeedReportUrl(url)).toBe(true);
    expect(isFeedReportUrl(url.replace('m.coolapk.com', 'm.coolapk.com.evil.test'))).toBe(false);
    expect(isFeedReportUrl(url.replace('https:', 'http:'))).toBe(false);
    expect(() => parseFeedReport(html.replace('value="42"', 'value="43"'), url)).toThrow('数据不完整');
    expect(() => parseFeedReport(html.replace('/mp/do?c=feed&m=report', 'https://evil.test/mp/do?c=feed&m=report'), url)).toThrow('地址无效');
    expect(parseFeedReport(html, url).content).not.toContain('evil');
  });
  it('展示作者、正文与真实选项，不在加载或选择时提交', async () => {
    const wrapper = mountPage(); await flushPromises();
    expect(wrapper.text()).toContain('作者'); expect(wrapper.text()).toContain('#手机#');
    expect(wrapper.findAll('input[type=radio]')).toHaveLength(2);
    expect(wrapper.get('.report-submit').attributes('disabled')).toBeDefined();
    await wrapper.get('input[value="小广告"]').setValue(true);
    expect(wrapper.get('.report-submit').attributes('disabled')).toBeUndefined();
    expect(mocks.submit).not.toHaveBeenCalled(); wrapper.unmount();
  });
  it('自定义原因不能为空，显式提交传递目标与令牌，阻止重复提交', async () => {
    let finish!: (value: unknown) => void;
    mocks.submit.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const wrapper = mountPage(); await flushPromises();
    await wrapper.get('input[value="其他"]').setValue(true);
    expect(wrapper.get('.report-submit').attributes('disabled')).toBeDefined();
    await wrapper.get('.report-custom-reason').setValue('自定义说明');
    await wrapper.get('form').trigger('submit'); await wrapper.get('form').trigger('submit');
    expect(mocks.submit).toHaveBeenCalledExactlyOnceWith('42', 'feed', '其他', '自定义说明', 'test-token', []);
    finish({ code: 200, data: { status: 1, message: '举报成功' } }); await flushPromises();
    expect(wrapper.get('[role=status]').text()).toBe('举报成功'); expect(wrapper.get('.report-submit').attributes('disabled')).toBeDefined(); wrapper.unmount();
  });
  it('拒绝或网络失败保留原因，不宣称成功，允许用户重试', async () => {
    mocks.submit.mockRejectedValueOnce('提交失败');
    const wrapper = mountPage(); await flushPromises(); await wrapper.get('input[value="小广告"]').setValue(true);
    await wrapper.get('form').trigger('submit'); await flushPromises();
    expect(wrapper.get('[role=alert]').text()).toContain('提交失败'); expect(wrapper.find('[role=status]').exists()).toBe(false);
    expect((wrapper.get('input[value="小广告"]').element as HTMLInputElement).checked).toBe(true);
    await wrapper.get('form').trigger('submit'); await flushPromises(); expect(mocks.submit).toHaveBeenCalledTimes(2); wrapper.unmount();
  });
  it('识别官方字符串状态码 200 成功并拒绝 403 等失败状态', async () => {
    mocks.submit.mockResolvedValueOnce({ code: 200, data: { status: '403', message: '服务器错误，请求不合法！' } });
    const wrapper = mountPage(); await flushPromises(); await wrapper.get('input[value="小广告"]').setValue(true);
    await wrapper.get('form').trigger('submit'); await flushPromises();
    expect(wrapper.get('[role=alert]').text()).toContain('服务器错误，请求不合法！'); expect(wrapper.find('[role=status]').exists()).toBe(false);
    mocks.submit.mockResolvedValueOnce({ code: 200, data: { status: '200', message: '举报成功，感谢您的反馈' } });
    await wrapper.get('form').trigger('submit'); await flushPromises();
    expect(wrapper.get('[role=status]').text()).toBe('举报成功，感谢您的反馈'); expect(wrapper.get('.report-submit').attributes('disabled')).toBeDefined(); wrapper.unmount();
  });
  it('未登录返回提示，不显示虚构原因或提交按钮', async () => {
    mocks.fetch.mockResolvedValue({ data: { html: '<div class="weui-msg__desc">请先登录</div>', status: 200 } });
    const wrapper = mountPage(); await flushPromises(); expect(wrapper.text()).toContain('请先登录'); expect(wrapper.find('form').exists()).toBe(false); wrapper.unmount();
  });
});
