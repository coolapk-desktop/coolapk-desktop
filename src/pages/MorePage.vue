<template>
  <div class="more-page-container custom-scrollbar">
    <!-- 顶部栏：桌面端显示标题与计数，移动端由顶部导航栏承载标题、仅展示搜索框 -->
    <div class="more-header-section">
      <div class="header-content">
        <div class="header-title-row">
          <div class="title-with-badge">
            <span class="hub-icon-wrapper">
              <i class="fas fa-shapes" aria-hidden="true"></i>
            </span>
            <h1 class="page-title">更多服务</h1>
          </div>
        </div>
      </div>

      <!-- 快捷搜索框 -->
      <div class="search-bar-wrapper">
        <i class="fas fa-search search-icon" aria-hidden="true"></i>
        <input
          v-model="searchQuery"
          type="text"
          class="hub-search-input"
          aria-label="查找专区、服务或功能"
          placeholder="快速查找专区、服务或功能..."
          @keydown.esc="searchQuery = ''"
        />
        <button
          v-if="searchQuery"
          type="button"
          class="clear-search-btn"
          title="清空搜索"
          aria-label="清空搜索"
          @click="searchQuery = ''"
        >
          <i class="fas fa-times" aria-hidden="true"></i>
        </button>
      </div>
    </div>

    <!-- 搜索结果模式 -->
    <div v-if="searchQuery.trim()" class="search-results-section">
      <section class="hub-section">
        <div class="section-header">
          <h2 class="section-title">
            <i class="fas fa-filter cat-icon" aria-hidden="true"></i>
            <span>搜索结果</span>
          </h2>
        </div>

        <div v-if="filteredSearchResults.length > 0" class="cards-grid search-cards-grid">
          <div
            v-for="item in filteredSearchResults"
            :key="item.id"
            class="hub-card-item"
            role="button"
            tabindex="0"
            @click="navigateTo(item.path)"
            @keydown.enter="navigateTo(item.path)"
          >
            <div class="hub-icon-circle">
              <i :class="item.icon" aria-hidden="true"></i>
            </div>
            <div class="hub-card-info">
              <span class="hub-card-title">{{ item.title }}</span>
            </div>
            <i class="fas fa-chevron-right hub-card-arrow" aria-hidden="true"></i>
          </div>
        </div>

        <div v-else class="empty-search-state">
          <i class="fas fa-search-minus empty-icon" aria-hidden="true"></i>
          <p class="empty-text">未找到与“{{ searchQuery }}”相关的专区或功能</p>
        </div>
      </section>
    </div>

    <!-- 默认浏览模式：常用核心金刚区 + 分类服务矩阵 -->
    <div v-else class="hub-content-body">
      <!-- 1. 常用与核心专区（10 项高频入口） -->
      <section class="hub-section featured-section">
        <div class="section-header">
          <h2 class="section-title">
            <i class="fas fa-compass cat-icon" aria-hidden="true"></i>
            <span>常用与核心专区</span>
          </h2>
        </div>

        <div class="featured-icons-grid">
          <button
            v-for="item in featuredItems"
            :key="item.id"
            type="button"
            class="featured-btn-item"
            @click="navigateTo(item.path)"
          >
            <span class="featured-icon-circle">
              <i :class="item.icon" aria-hidden="true"></i>
            </span>
            <span class="featured-item-title">{{ item.title }}</span>
          </button>
        </div>
      </section>

      <!-- 2. 分类板块组（全部偶数项对齐双列网格，无孤立单行） -->
      <div class="categories-container">
        <section
          v-for="cat in displayCategories"
          :key="cat.id"
          :class="['hub-section', 'category-section', `category-${cat.id}`]"
        >
          <div class="section-header">
            <h2 class="section-title">
              <i :class="[cat.icon, 'cat-icon']" aria-hidden="true"></i>
              <span>{{ cat.title }}</span>
            </h2>
          </div>

          <div class="cards-grid">
            <div
              v-for="item in cat.items"
              :key="item.id"
              class="hub-card-item"
              role="button"
              tabindex="0"
              @click="navigateTo(item.path)"
              @keydown.enter="navigateTo(item.path)"
            >
              <div class="hub-icon-circle">
                <i :class="item.icon" aria-hidden="true"></i>
              </div>
              <div class="hub-card-info">
                <span class="hub-card-title">{{ item.title }}</span>
              </div>
              <i class="fas fa-chevron-right hub-card-arrow" aria-hidden="true"></i>
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { webRouteFallback } from '../router/webRoutes';

interface HubItem {
  id: string;
  title: string;
  shortDesc: string;
  desc: string;
  icon: string;
  path: string;
  tags?: string[];
}

interface HubCategory {
  id: string;
  title: string;
  icon: string;
  items: HubItem[];
}

const router = useRouter();
const searchQuery = ref('');

function navigateTo(path: string) {
  router.push(path);
}

// 常用入口也保留合并前分类条目的搜索词，避免服务去重后丢失匹配。
const featuredItems = ([
  {
    id: 'apps',
    title: '应用',
    shortDesc: '应用中心',
    desc: '浏览酷安应用、游戏和软件详情，查找需要的安装包',
    icon: 'fas fa-cubes',
    path: '/apps',
    tags: ['应用', '软件', '游戏', '应用中心'],
  },
  {
    id: 'downloads',
    title: '下载',
    shortDesc: '下载管理',
    desc: '管理应用和游戏安装包的下载任务与历史记录',
    icon: 'fas fa-download',
    path: '/downloads',
    tags: ['下载', '安装包', '下载管理'],
  },
  {
    id: 'my-products',
    title: '我的数码',
    shortDesc: '我的装备',
    desc: '管理正在使用的数码设备、评分与真实点评',
    icon: 'fas fa-box-open',
    path: '/my-products',
    tags: ['数码', '装备', '手机', '我的', '我的数码装备', '设备管理', '登记并管理正在使用的数码设备，撰写打分与点评'],
  },
  {
    id: 'goods',
    title: '好物推荐',
    shortDesc: '精选折扣',
    desc: '社区酷友精选数码好物、实时好价与折扣榜单',
    icon: 'fas fa-gift',
    path: '/goods',
    tags: ['好物', '优惠', '折扣', '购买', '清单', '精选好物', '特惠', '真实好物口碑排行榜、折扣爆料与值得买清单'],
  },
  {
    id: 'center',
    title: '酷安中心',
    shortDesc: '创作者/福利',
    desc: '官方活动福利、创作者激励计划与身份认证',
    icon: 'fas fa-shapes',
    path: '/center',
    tags: ['中心', '官方', '活动', '认证', '福利', '官方权益', '创作者', '创作者收益、官方活动中心、身份头衔认证'],
  },
  {
    id: 'albums',
    title: '我的专辑',
    shortDesc: '收藏合集',
    desc: '创建并管理精选动态、应用与数码主题合集',
    icon: 'fas fa-layer-group',
    path: '/albums',
    tags: ['专辑', '合集', '整理', '收藏', '我的专辑合集', '专辑收藏', '汇聚优质动态与好玩应用的自定义主题专辑'],
  },
  {
    id: 'pictures',
    title: '酷图精选',
    shortDesc: '壁纸大图',
    desc: '发现酷友分享的高清摄影、精美手机壁纸与图赏',
    icon: 'far fa-image',
    path: '/pictures',
    tags: ['酷图', '壁纸', '摄影', '美图', '酷图与壁纸精选', '高清图赏', '海量高清手机壁纸、数码摄影大图与调色交流'],
  },
  {
    id: 'secondhand',
    title: '二手市场',
    shortDesc: '闲置数码',
    desc: '酷友真实闲置数码好物流转与安全交流',
    icon: 'fas fa-store',
    path: '/secondhand',
    tags: ['二手', '闲置', '交易', '买卖', '闲置流转', '数码玩家闲置流通，真实成色与自提交流'],
  },
  {
    id: 'reviews',
    title: '评测专区',
    shortDesc: '深度体验',
    desc: '客观真实的深度机型体验与专业产品评测',
    icon: 'fas fa-flask',
    path: '/reviews',
    tags: ['评测', '体验', '测评', '数码深度评测', '专业测评', '文章', '数码发烧友与专业作者带来的硬核深度使用报告'],
  },
  {
    id: 'games',
    title: '游戏中心',
    shortDesc: '精品好游',
    desc: '发现高分热门手游、单机神作与游戏社区',
    icon: 'fas fa-gamepad',
    path: '/games',
    tags: ['游戏', '好游', '手游', '单机'],
  },
] satisfies HubItem[]).filter(item => !webRouteFallback(item.path));

// 2. 分类板块定义（与常用区去重后为 4 + 2 + 2 共 8 项，全部呈对称双列排布）
const hubCategories: HubCategory[] = [
  {
    id: 'community',
    title: '内容与社区生态',
    icon: 'fas fa-users',
    items: [
      {
        id: 'my_dyh',
        title: '我的看看号',
        shortDesc: '订阅专栏',
        desc: '关注的官方自媒体号、科技媒体与独立专栏',
        icon: 'fas fa-building-columns',
        path: '/my-dyh',
        tags: ['看看号', '媒体', '专栏'],
      },
      {
        id: 'headline_cat',
        title: '头条快讯',
        shortDesc: '要闻聚合',
        desc: '精选科技要闻、官方头条榜单与行业新鲜事',
        icon: 'fas fa-newspaper',
        path: '/headline',
        tags: ['头条', '新闻', '快讯', '头条快讯要闻'],
      },
      {
        id: 'events_cat',
        title: '酷友圈活动',
        shortDesc: '有奖活动',
        desc: '参与官方有奖征文、话题打卡与众测评测试用',
        icon: 'fas fa-trophy',
        path: '/events',
        tags: ['活动', '酷友圈活动', '活动中心', '征文', '抽奖'],
      },
      {
        id: 'my_plugins',
        title: '我的挂件',
        shortDesc: '头像与动态装扮',
        desc: '预览和管理头像挂件、动态挂件，浏览挂件商店',
        icon: 'fas fa-shirt',
        path: '/my-plugins',
        tags: ['挂件', '装扮', '商店'],
      },
    ],
  },
  {
    id: 'digital',
    title: '数码与装备专区',
    icon: 'fas fa-mobile-alt',
    items: [
      {
        id: 'product_compare',
        title: '机型多维对比',
        shortDesc: '参数对比',
        desc: '多款数码机型参数规格、屏幕性能与跑分全面对比',
        icon: 'fas fa-balance-scale',
        path: '/product-selector?mode=compare',
        tags: ['对比', '参数', '选机'],
      },
      {
        id: 'product_selector',
        title: '精准选机中心',
        shortDesc: '选机助手',
        desc: '按预算、品牌、处理器与拍照需求智能筛选机型',
        icon: 'fas fa-filter',
        path: '/product-selector',
        tags: ['选机', '筛选', '购买'],
      },
    ],
  },
  {
    id: 'tools',
    title: '实用工具与清单',
    icon: 'fas fa-toolbox',
    items: [
      {
        id: 'anylist_cat',
        title: '全能清单',
        shortDesc: '清单管理',
        desc: '创建并管理你的个性化清单、游戏排行与待办汇总',
        icon: 'fas fa-list-check',
        path: '/anylist',
        tags: ['清单', 'anylist', '管理', '全能清单 AnyList'],
      },
      {
        id: 'blacklist_cat',
        title: '黑名单管理',
        shortDesc: '屏蔽管理',
        desc: '管理屏蔽的用户、动态与标签，净化浏览体验',
        icon: 'fas fa-user-slash',
        path: '/blacklist',
        tags: ['黑名单', '屏蔽', '隐私'],
      },
    ],
  },
];

const featuredPaths = new Set(featuredItems.map((item) => item.path));
const displayCategories = hubCategories
  .map((category) => ({
    ...category,
    items: category.items.filter((item) => !featuredPaths.has(item.path)),
  }))
  .filter((category) => category.items.length);

// 全部唯一服务列表（18 项），供全局搜索使用
const allItems = computed(() => {
  const list: HubItem[] = [];
  const addedPaths = new Set<string>();

  for (const item of [...featuredItems, ...hubCategories.flatMap((category) => category.items)]) {
    if (!addedPaths.has(item.path)) {
      addedPaths.add(item.path);
      list.push(item);
    }
  }
  return list;
});

// 搜索过滤逻辑
const filteredSearchResults = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  if (!query) return [];

  return allItems.value.filter((item) => {
    const titleMatch = item.title.toLowerCase().includes(query);
    const shortMatch = item.shortDesc?.toLowerCase().includes(query);
    const descMatch = item.desc.toLowerCase().includes(query);
    const tagMatch = item.tags?.some((t) => t.toLowerCase().includes(query));
    return titleMatch || shortMatch || descMatch || tagMatch;
  });
});
</script>

<style scoped>
.more-page-container {
  flex: 1;
  width: 100%;
  height: 100%;
  overflow-y: auto;
  padding: 20px 24px 48px;
  background-color: var(--background);
  color: var(--text-primary);
  box-sizing: border-box;
}

/* 顶部栏 */
.more-header-section {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  max-width: 1120px;
  margin: 0 auto 16px;
}

.header-content {
  display: flex;
  align-items: center;
  min-width: 0;
}

.header-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.title-with-badge {
  display: flex;
  align-items: center;
  gap: 9px;
}

.hub-icon-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 9px;
  background: var(--brand-soft);
  color: var(--brand-primary);
  font-size: 15px;
}

.page-title {
  font-size: 19px;
  font-weight: 700;
  margin: 0;
  color: var(--text-primary);
  letter-spacing: -0.01em;
}

.hub-count-tag {
  font-size: 12px;
  color: var(--text-tertiary);
  background-color: var(--surface);
  padding: 3px 9px;
  border-radius: 999px;
  border: 1px solid var(--border-light);
}

/* 搜索框 */
.search-bar-wrapper {
  position: relative;
  width: 260px;
  flex-shrink: 0;
}

.search-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-tertiary);
  font-size: 12.5px;
  pointer-events: none;
}

.hub-search-input {
  width: 100%;
  height: 36px;
  padding: 0 32px 0 34px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background-color: var(--surface);
  color: var(--text-primary);
  font-size: 13px;
  outline: none;
  transition: all 0.15s ease;
  box-sizing: border-box;
}

.hub-search-input::placeholder {
  color: var(--text-secondary);
}

.hub-search-input:focus {
  border-color: var(--brand-primary);
  box-shadow: 0 0 0 3px var(--brand-soft);
}

.clear-search-btn {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 12px;
}

.clear-search-btn:hover {
  background: var(--surface-hover);
  color: var(--text-primary);
}

/* 主体容器 */
.hub-content-body,
.search-results-section {
  max-width: 1120px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* 统一卡片容器 */
.hub-section {
  background: var(--surface);
  border: 1px solid var(--border-light);
  border-radius: 14px;
  padding: 16px 18px;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 12px;
}

.section-title {
  font-size: 14.5px;
  font-weight: 650;
  color: var(--text-primary);
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.cat-icon {
  color: var(--brand-primary);
  font-size: 14px;
}

.section-count {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-tertiary);
}

/* 1. 常用与核心专区（桌面端 5x2 轻量磁贴，移动端 5x2 经典金刚区） */
.featured-icons-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 10px;
}

.featured-btn-item {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 9px 12px;
  border: 1px solid var(--border-light);
  background: var(--background);
  border-radius: 10px;
  cursor: pointer;
  text-align: left;
  transition: all 0.16s ease;
}

.featured-btn-item:hover {
  background-color: var(--surface-hover);
  border-color: color-mix(in srgb, var(--brand-primary) 35%, var(--border));
}

.featured-btn-item:focus-visible {
  outline: 2px solid var(--brand-primary);
  outline-offset: 2px;
}

.featured-icon-circle {
  width: 34px;
  height: 34px;
  border-radius: 9px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  color: var(--brand-primary);
  background-color: var(--brand-soft);
  transition: all 0.16s ease;
}

.featured-btn-item:hover .featured-icon-circle {
  background-color: var(--brand-primary);
  color: #ffffff;
}

.featured-item-title {
  flex: 1;
  min-width: 0;
  font-size: 13.5px;
  font-weight: 550;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 2. 分类板块容器：桌面端左 4（跨两行）+ 右 2+2 对称双栏 Bento 布局 */
.categories-container {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  align-items: start;
}

.category-community {
  grid-row: span 2;
}

.cards-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.search-cards-grid {
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
}

.hub-card-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  min-height: 50px;
  background: var(--background);
  border: 1px solid var(--border-light);
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.16s ease;
  outline: none;
  box-sizing: border-box;
}

.hub-card-item:hover,
.hub-card-item:focus-visible {
  border-color: color-mix(in srgb, var(--brand-primary) 35%, var(--border));
  background-color: var(--surface-hover);
}

.hub-card-item:focus-visible {
  outline: 2px solid var(--brand-primary);
  outline-offset: 2px;
}

/* 分类条目图标统一采用酷安品牌绿 */
.hub-icon-circle {
  width: 34px;
  height: 34px;
  border-radius: 9px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  color: var(--brand-primary);
  background-color: var(--brand-soft);
  transition: all 0.16s ease;
}

.hub-card-item:hover .hub-icon-circle {
  color: #ffffff;
  background-color: var(--brand-primary);
}

.hub-card-info {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
}

.hub-card-title {
  font-size: 13.5px;
  font-weight: 550;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.hub-card-arrow {
  color: var(--text-tertiary);
  font-size: 11px;
  opacity: 0.45;
  flex-shrink: 0;
  transition: all 0.16s ease;
}

.hub-card-item:hover .hub-card-arrow {
  opacity: 1;
  color: var(--brand-primary);
  transform: translateX(2px);
}

/* 空搜索状态 */
.empty-search-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 16px;
  color: var(--text-tertiary);
  gap: 10px;
  text-align: center;
}

.empty-icon {
  font-size: 32px;
  opacity: 0.4;
}

.empty-text {
  font-size: 13.5px;
  margin: 0;
}

@media (max-width: 960px) and (min-width: 721px) {
  .featured-icons-grid {
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  }

  .categories-container {
    grid-template-columns: 1fr;
  }

  .category-community {
    grid-row: auto;
  }
}

/* 移动端布局：极简清爽，金刚区 + 对称双列胶囊卡片，一屏尽览 */
@media (max-width: 720px) {
  .more-page-container {
    min-width: 0;
    padding: 10px 12px calc(24px + env(safe-area-inset-bottom, 0px));
  }

  .more-header-section {
    margin-bottom: 12px;
  }

  /* 移动端顶栏已有“更多服务”标题，隐藏内页重复标题 */
  .header-content {
    display: none;
  }

  .search-bar-wrapper {
    width: 100%;
  }

  .hub-search-input {
    height: 38px;
    padding-right: 38px;
    border-radius: 10px;
    border-color: var(--border-light);
    font-size: 13.5px;
  }

  .clear-search-btn {
    right: 6px;
    width: 30px;
    height: 30px;
  }

  .hub-content-body,
  .search-results-section {
    gap: 12px;
  }

  .hub-section {
    padding: 12px;
    border-radius: 12px;
  }

  .section-header {
    margin-bottom: 10px;
  }

  .section-title {
    font-size: 13.5px;
    font-weight: 600;
  }

  /* 1. 移动端 5x2 金刚区 */
  .featured-icons-grid {
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 6px 2px;
  }

  .featured-btn-item {
    flex-direction: column;
    justify-content: center;
    align-items: center;
    text-align: center;
    gap: 6px;
    padding: 6px 2px;
    border: 0;
    background: transparent;
    border-radius: 10px;
  }

  .featured-icon-circle {
    width: 38px;
    height: 38px;
    border-radius: 11px;
    font-size: 16px;
  }

  .featured-item-title {
    flex: none;
    width: 100%;
    font-size: 12px;
    font-weight: 500;
    line-height: 1.3;
  }

  /* 2. 移动端分类卡片：统一双列紧凑胶囊，全偶数对齐无空缺 */
  .categories-container {
    grid-template-columns: 1fr;
    gap: 12px;
  }

  .category-community {
    grid-row: auto;
  }

  .cards-grid,
  .search-cards-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }

  .hub-card-item {
    min-height: 44px;
    padding: 8px 10px;
    gap: 9px;
    border-radius: 9px;
    border: 0;
    background: var(--background);
  }

  .hub-icon-circle {
    width: 28px;
    height: 28px;
    border-radius: 7px;
    font-size: 13px;
    color: var(--brand-primary);
    background: var(--brand-soft);
    border: 0;
  }

  .hub-card-title {
    font-size: 13px;
    font-weight: 500;
  }

  /* 移动端双列胶囊隐藏右侧箭头，保证文字完整舒展 */
  .hub-card-arrow {
    display: none;
  }

  .featured-btn-item:hover,
  .featured-btn-item:hover .featured-icon-circle,
  .hub-card-item:hover,
  .hub-card-item:focus-visible {
    transform: none;
    box-shadow: none;
  }

  .featured-btn-item:hover .featured-icon-circle,
  .hub-card-item:hover .hub-icon-circle {
    color: var(--brand-primary);
    background-color: var(--brand-soft);
  }

  .featured-btn-item:active,
  .hub-card-item:active {
    background: var(--brand-soft);
  }
}

@media (max-width: 359px) {
  .featured-icons-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .cards-grid,
  .search-cards-grid {
    grid-template-columns: 1fr;
  }
}
</style>
