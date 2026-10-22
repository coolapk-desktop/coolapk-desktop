import { createRouter, createWebHashHistory } from 'vue-router';
import HomePage from '../pages/HomePage.vue';
import ProductSelectorPage from '../pages/ProductSelectorPage.vue';

// 首次进入时再加载对应页面和样式；Vue Router 会等待本地资源就绪后切换，已访问页面复用模块缓存。
const SearchPage = () => import('../pages/SearchPage.vue');
const NotificationsPage = () => import('../pages/NotificationsPage.vue');
const MessagesPage = () => import('../pages/MessagesPage.vue');
const DiscoverPage = () => import('../pages/DiscoverPage.vue');
const AppsPage = () => import('../pages/AppsPage.vue');
const GamesPage = () => import('../pages/GamesPage.vue');
const DownloadsPage = () => import('../pages/DownloadsPage.vue');
const FavoritesPage = () => import('../pages/FavoritesPage.vue');
const MyLikesPage = () => import('../pages/MyLikesPage.vue');
const MoreWorkspacePage = () => import('../pages/MoreWorkspacePage.vue');
const MoreDataPage = () => import('../pages/MoreDataPage.vue');
const MyAlbumsPage = () => import('../pages/MyAlbumsPage.vue');
const HistoryPage = () => import('../pages/HistoryPage.vue');
const FollowingPage = () => import('../pages/FollowingPage.vue');
const UserPage = () => import('../pages/UserPage.vue');
const UserRelationsPage = () => import('../pages/UserRelationsPage.vue');
const FeedDetailPage = () => import('../pages/FeedDetailPage.vue');
const QuestionDetailPage = () => import('../pages/QuestionDetailPage.vue');
const LiveDetailPage = () => import('../pages/LiveDetailPage.vue');
const BlackListPage = () => import('../pages/BlackListPage.vue');
const TopicPage = () => import('../pages/TopicPage.vue');
const TopicsHubPage = () => import('../pages/TopicsHubPage.vue');
const AppDetailPage = () => import('../pages/AppDetailPage.vue');
const ProductPage = () => import('../pages/ProductPage.vue');
const DyhPage = () => import('../pages/DyhPage.vue');
const AlbumPage = () => import('../pages/AlbumPage.vue');
const AlbumsPage = () => import('../pages/AlbumsPage.vue');
const PicturesPage = () => import('../pages/PicturesPage.vue');
const HeadlinePage = () => import('../pages/HeadlinePage.vue');
const PageDataListPage = () => import('../pages/PageDataListPage.vue');
const ReviewPage = () => import('../pages/ReviewPage.vue');
const SecondHandPage = () => import('../pages/SecondHandPage.vue');
const SecondHandListPage = () => import('../pages/SecondHandListPage.vue');
const SecondHandBrandsPage = () => import('../pages/SecondHandBrandsPage.vue');
const EventsPage = () => import('../pages/EventsPage.vue');
const EventDetailPage = () => import('../pages/EventDetailPage.vue');
const NodePage = () => import('../pages/NodePage.vue');
const AnyListPage = () => import('../pages/AnyListPage.vue');
const AnyListDetailPage = () => import('../pages/AnyListDetailPage.vue');
const AnyListCreatePage = () => import('../pages/AnyListCreatePage.vue');
const MyDyhPage = () => import('../pages/MyDyhPage.vue');
const CenterPage = () => import('../pages/CenterPage.vue');
const ExternalPage = () => import('../pages/ExternalPage.vue');
const GoodsPage = () => import('../pages/GoodsPage.vue');
const GoodsListDetailPage = () => import('../pages/GoodsListDetailPage.vue');
const GoodsRankingDetailPage = () => import('../pages/GoodsRankingDetailPage.vue');
const DigitalPage = () => import('../pages/DigitalPage.vue');
const MyProductsPage = () => import('../pages/MyProductsPage.vue');
const ProductComparePage = () => import('../pages/ProductComparePage.vue');
const MorePage = () => import('../pages/MorePage.vue');
const MyProfilePage = () => import('../pages/MyProfilePage.vue');
const UserPluginsPage = () => import('../pages/UserPluginsPage.vue');
const SettingsLayout = () => import('../pages/settings/SettingsLayout.vue');
const ProfileSettingsPage = () => import('../pages/settings/ProfileSettingsPage.vue');
const AccountSettingsPage = () => import('../pages/settings/AccountSettingsPage.vue');
const NotificationSettingsPage = () => import('../pages/settings/NotificationSettingsPage.vue');
const PrivacySettingsPage = () => import('../pages/settings/PrivacySettingsPage.vue');
const ContentSettingsPage = () => import('../pages/settings/ContentSettingsPage.vue');
const DownloadSettingsPage = () => import('../pages/settings/DownloadSettingsPage.vue');
const NetworkSettingsPage = () => import('../pages/settings/NetworkSettingsPage.vue');
const AppearanceSettingsPage = () => import('../pages/settings/AppearanceSettingsPage.vue');
const ShortcutSettingsPage = () => import('../pages/settings/ShortcutSettingsPage.vue');
const AboutSettingsPage = () => import('../pages/settings/AboutSettingsPage.vue');
const StartupSettingsPage = () => import('../pages/settings/StartupSettingsPage.vue');
const DeviceSettingsPage = () => import('../pages/settings/DeviceSettingsPage.vue');
const DiagnosticsSettingsPage = () => import('../pages/settings/DiagnosticsSettingsPage.vue');
import { restoreRouteScrollPosition, routeNavigationIsHistory, saveRouteScrollPosition } from '../utils/routeScroll';
import { logDiagnostic, setDiagnosticPage, summarizeDiagnosticError } from '../utils/diagnosticLogger';

const AuthCallbackView = () => import('../pages/AuthCallbackView.vue');

const routes = [
  { path: '/', name: 'Home', component: HomePage },
  { path: '/auth_callback', name: 'AuthCallback', component: AuthCallbackView },
  { path: '/feeds', name: 'Feeds', redirect: '/' },
  { path: '/discover', name: 'Discover', component: DiscoverPage },
  { path: '/apps', name: 'Apps', component: AppsPage },
  { path: '/games', name: 'Games', component: GamesPage },
  { path: '/downloads', name: 'Downloads', component: DownloadsPage },
  { path: '/topics', name: 'Topics', component: TopicsHubPage },
  { path: '/favorites', name: 'Favorites', component: FavoritesPage },
  { path: '/collection/:collectionId', redirect: (to: any) => ({ path: '/favorites', query: { collectionId: to.params.collectionId } }) },
  { path: '/my-likes', name: 'MyLikes', component: MyLikesPage },
  { path: '/more', name: 'More', component: MorePage },
  { path: '/me', name: 'MyProfile', component: MyProfilePage },
  { path: '/my-plugins', name: 'UserPlugins', component: UserPluginsPage },
  { path: '/my-plugins/store', name: 'UserPluginStore', component: UserPluginsPage },
  { path: '/my', name: 'My', component: MoreWorkspacePage },
  { path: '/followed-nodes', name: 'FollowedNodes', component: MoreDataPage, meta: { mode: 'nodes' } },
  { path: '/followed-topics', name: 'FollowedTopics', component: MoreDataPage, meta: { mode: 'topics' } },
  { path: '/recent-contacts', name: 'RecentContacts', component: MoreDataPage, meta: { mode: 'contacts' } },
  { path: '/recycle-bin', name: 'RecycleBin', component: MoreDataPage, meta: { mode: 'recycle' } },
  { path: '/hidden-replies', name: 'HiddenReplies', component: MoreDataPage, meta: { mode: 'hidden' } },
  { path: '/my-devices', name: 'MyDevices', component: MoreDataPage, meta: { mode: 'devices' } },
  { path: '/my-albums', name: 'MyAlbums', component: MyAlbumsPage },
  { path: '/my-votes', name: 'MyVotes', component: MoreDataPage, meta: { mode: 'votes' } },
  { path: '/history', name: 'History', component: HistoryPage },
  { path: '/following', name: 'Following', component: FollowingPage },
  { path: '/reviews', name: 'Reviews', component: ReviewPage },
  { path: '/secondhand', name: 'SecondHand', component: SecondHandPage },
  { path: '/secondhand/brands', name: 'SecondHandBrands', component: SecondHandBrandsPage },
  { path: '/secondhand/list', name: 'SecondHandList', component: SecondHandListPage },
  { path: '/events', name: 'Events', component: EventsPage },
  { path: '/event/:eventId', name: 'EventDetail', component: EventDetailPage, props: true },
  { path: '/node/:nodeType/:nodeId', name: 'Node', component: NodePage },
  { path: '/anylist', name: 'AnyList', component: AnyListPage },
  { path: '/anylist/create', name: 'AnyListCreate', component: AnyListCreatePage },
  { path: '/anylist/:listId', name: 'AnyListDetail', component: AnyListDetailPage, props: true },
  { path: '/my-dyh', name: 'MyDyh', component: MyDyhPage },
  { path: '/center', name: 'Center', component: CenterPage },
  { path: '/external', name: 'External', component: ExternalPage },
  { path: '/product-selector', name: 'ProductSelector', component: ProductSelectorPage },
  { path: '/goods', name: 'Goods', component: GoodsPage },
  { path: '/goods/search', redirect: '/goods?tab=search' },
  { path: '/goods/mine', redirect: '/goods?tab=mine' },
  { path: '/goods/lists', redirect: '/goods?tab=lists' },
  { path: '/goods/ranking', redirect: '/goods?tab=ranking' },
  { path: '/goods/lists/:feedId', name: 'GoodsListDetail', component: GoodsListDetailPage },
  { path: '/goods/ranking/:feedId', name: 'GoodsRankingDetail', component: GoodsRankingDetailPage },
  { path: '/digital', name: 'Digital', component: DigitalPage },
  { path: '/digital-library', name: 'DigitalLibrary', redirect: '/digital' },
  { path: '/my-products', name: 'MyProducts', component: MyProductsPage },
  { path: '/product-compare', name: 'ProductCompare', component: ProductComparePage },
  { path: '/search', name: 'Search', component: SearchPage },
  { path: '/notifications', name: 'Notifications', component: NotificationsPage },
  { path: '/messages', name: 'Messages', component: MessagesPage },
  { path: '/user/:uid', name: 'User', component: UserPage },
  { path: '/user/:uid/relations/:relation(follow|fans)', name: 'UserRelations', component: UserRelationsPage },
  { path: '/feed/:feedId', name: 'FeedDetail', component: FeedDetailPage, props: true },
  { path: '/question/:questionId', name: 'QuestionDetail', component: QuestionDetailPage, props: true },
  { path: '/live/:liveId', name: 'LiveDetail', component: LiveDetailPage, props: true },
  { path: '/blacklist', name: 'BlackList', component: BlackListPage },
  { path: '/topic/:tag', name: 'Topic', component: TopicPage },
  { path: '/app/:packageName', name: 'AppDetail', component: AppDetailPage },
  { path: '/product/:productId', name: 'Product', component: ProductPage },
  { path: '/dyh/:dyhId', name: 'Dyh', component: DyhPage },
  { path: '/album/:albumId', name: 'AlbumDetail', component: AlbumPage },
  { path: '/albums', name: 'Albums', component: AlbumsPage },
  { path: '/pictures', name: 'Pictures', component: PicturesPage },
  { path: '/headline', name: 'Headline', component: HeadlinePage },
  { path: '/page', name: 'PageDataList', component: PageDataListPage },
  {
    path: '/settings',
    component: SettingsLayout,
    redirect: '/settings/appearance',
    children: [
      { path: 'profile', component: ProfileSettingsPage },
      { path: 'account', component: AccountSettingsPage },
      { path: 'notifications', component: NotificationSettingsPage },
      { path: 'privacy', component: PrivacySettingsPage },
      { path: 'content', component: ContentSettingsPage },
      { path: 'downloads', component: DownloadSettingsPage },
      { path: 'network', component: NetworkSettingsPage },
      { path: 'appearance', component: AppearanceSettingsPage },
      { path: 'shortcuts', component: ShortcutSettingsPage },
      { path: 'startup', component: StartupSettingsPage },
      { path: 'device', component: DeviceSettingsPage },
      { path: 'diagnostics', component: DiagnosticsSettingsPage, props: (route: import('vue-router').RouteLocationNormalized) => ({ reportUrl: String(route.query.report || '') }) },
      { path: 'about', component: AboutSettingsPage },
    ]
  }
];

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
  scrollBehavior(_to, _from, savedPosition) {
    if (savedPosition) return savedPosition;
    return { top: 0 };
  }
});

let pendingHistoryNavigation = false;
router.options.history.listen(() => { pendingHistoryNavigation = true; });

router.beforeEach((_to, from) => {
  routeNavigationIsHistory.value = pendingHistoryNavigation;
  pendingHistoryNavigation = false;
  saveRouteScrollPosition(from.fullPath);
});

router.onError(error => logDiagnostic('error', 'navigation', 'failed', summarizeDiagnosticError(error)));
router.afterEach((to, from, failure) => {
  const page = String(to.name || to.matched.map((record) => record.path).join('>') || 'unnamed');
  const previousPage = String(from.name || from.matched.map((record) => record.path).join('>') || 'startup');
  if (failure) {
    logDiagnostic('warn', 'navigation', 'not_completed', `from=${previousPage} to=${page} type=${failure.type}`);
    return;
  }
  setDiagnosticPage(page);
  logDiagnostic('info', 'navigation', 'route_changed', `from=${previousPage} to=${page}`);
  // 卡片正文与回复图标明确指定落点，由详情页在内容挂载后定位，不能再用缓存覆盖。
  if (!routeNavigationIsHistory.value && to.name === 'FeedDetail' && ['top', 'comments'].includes(String(to.query.scrollTo || ''))) return;
  void restoreRouteScrollPosition(to.fullPath);
});
