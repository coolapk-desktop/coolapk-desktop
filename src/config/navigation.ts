import type { MoreNavItem } from '../types/navigation';

export const moreNavs: MoreNavItem[] = [
  { key: 'my_likes', path: '/my?section=my_likes', label: '我的赞', icon: 'far fa-thumbs-up' },
  { key: 'my_comments', path: '/my?section=my_comments', label: '我的评论', icon: 'far fa-comment-dots' },
  { key: 'my_feeds', path: '/my?section=my_feeds', label: '我的动态', icon: 'fas fa-stream' },
  { key: 'followed_nodes', path: '/my?section=followed_nodes', label: '关注的论坛', icon: 'fas fa-comments' },
  { key: 'followed_topics', path: '/my?section=followed_topics', label: '关注的话题', icon: 'fas fa-hashtag' },
  { key: 'followed_apps', path: '/my?section=followed_apps', label: '关注的应用', icon: 'fas fa-cube' },
  { key: 'followed_collections', path: '/my?section=followed_collections', label: '关注的收藏单', icon: 'fas fa-folder-open' },
  { key: 'followed_questions', path: '/my?section=followed_questions', label: '关注的问题', icon: 'fas fa-circle-question' },
  { key: 'followed_products', path: '/my?section=followed_products', label: '关注的数码吧', icon: 'fas fa-mobile-screen-button' },
  { key: 'recent_contacts', path: '/my?section=recent_contacts', label: '最近联系人', icon: 'far fa-address-book' },
  { key: 'recycle_bin', path: '/my?section=recycle_bin', label: '内容回收站', icon: 'fas fa-trash-can' },
  { key: 'hidden_replies', path: '/my?section=hidden_replies', label: '隐藏的回复', icon: 'far fa-eye-slash' },
  { key: 'my_devices', path: '/my?section=my_devices', label: '我的设备', icon: 'fas fa-mobile-screen-button' },
  { key: 'my_albums', path: '/my?section=my_albums', label: '我的专辑', icon: 'fas fa-layer-group' },
  { key: 'my_votes', path: '/my?section=my_votes', label: '我的投票', icon: 'fas fa-square-poll-vertical' },
  { key: 'my_recent', path: '/my?section=my_recent', label: '我的常去', icon: 'fas fa-star' },
];
