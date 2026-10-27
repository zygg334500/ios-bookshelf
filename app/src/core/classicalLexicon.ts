/**
 * Compact offline glosses for classical Chinese (文言 → 白话).
 * Definitions are short original notes, not a copy of a published dictionary.
 * Add entries here, or pass `extra` into `lookupClassical`, to extend the set.
 * Keys include the simplified form and the traditional forms a reader might be showing.
 */

export type LexiconEntry = {
  keys: string[];
  senses: string[];
};

export type GlossHit = {
  word: string;
  senses: string[];
};

export const CLASSICAL_LEXICON: LexiconEntry[] = [
  { keys: ['之'], senses: ['的；它；到', '助词，相当于「的」。也可作代词「它」，或动词「往、到」。'] },
  { keys: ['其'], senses: ['他的；那；大概', '代词，多指他的、他们的，或那。有时表推测，相当于「大概」。'] },
  { keys: ['者'], senses: ['……的人；……的事物', '附在动词或形容词后，把它们收成「……的人 / 事物」。'] },
  { keys: ['也'], senses: ['表判断或停顿', '句末语气，常用来判断「是」。也可在句中略作停顿。'] },
  { keys: ['乎'], senses: ['吗；呢；在', '句末疑问，相当于「吗、呢」。介词时相当于「于」。'] },
  { keys: ['而'], senses: ['并且；却；你的', '连词，可顺接也可转折。代词时相当于「你的」。'] },
  { keys: ['以'], senses: ['用；凭；因为', '介词。用、凭借，或因为。也可表示「来」。'] },
  { keys: ['为', '為', '爲'], senses: ['做；是；被', '动词，做、当作、是。放在动词前可表被动「被」。'] },
  { keys: ['于', '於'], senses: ['在；向；比', '介词。在、向、对、比，或被动。'] },
  { keys: ['所'], senses: ['……的东西；地方', '加在动词前，指动作的对象或处所。'] },
  { keys: ['乃'], senses: ['于是；才；是', '副词，于是、才。也可表判断「是」。'] },
  { keys: ['则', '則'], senses: ['就；那么', '连词，那么、就。'] },
  { keys: ['若'], senses: ['如果；像；你', '如果，或像。代词时是「你」。'] },
  { keys: ['且'], senses: ['而且；将要', '并且、况且，或将要。'] },
  { keys: ['与', '與'], senses: ['和；给；参加', '和、给、结交。句末读 yú 时同「欤」，表疑问。'] },
  { keys: ['焉'], senses: ['于此；哪里；呢', '兼词，相当于「于之」。也可问「哪里」，或作句末语气。'] },
  { keys: ['矣'], senses: ['了', '句末，表示已经如此，或将要如此。'] },
  { keys: ['哉'], senses: ['啊', '感叹，或反问。'] },
  { keys: ['盖', '蓋'], senses: ['大概；因为', '句首发语，或表推测「大概」。也可解释原因。'] },
  { keys: ['故'], senses: ['所以；旧的', '所以、原因。形容词时是旧。'] },
  { keys: ['夫'], senses: ['句首语气；那；丈夫', '句首发语词。也可指那，或丈夫。'] },
  { keys: ['曰'], senses: ['说', '说。引语前常见。'] },
  { keys: ['云'], senses: ['说', '说。文言里的「云」常常不是「云彩」。'] },
  { keys: ['谓', '謂'], senses: ['说；叫做；认为', '对……说，叫做，或认为。'] },
  { keys: ['何'], senses: ['什么；为什么', '什么、哪里、为什么。'] },
  { keys: ['安'], senses: ['怎么；哪里', '怎么、哪里。'] },
  { keys: ['胡'], senses: ['为什么；什么', '为什么、什么。'] },
  { keys: ['奚'], senses: ['为什么；哪里', '何。'] },
  { keys: ['曷'], senses: ['何', '什么、为什么。'] },
  { keys: ['盍'], senses: ['何不', '为什么不。'] },
  { keys: ['岂', '豈'], senses: ['难道', '反问。'] },
  { keys: ['毋'], senses: ['不要', '不要、别。'] },
  { keys: ['勿'], senses: ['不要', '不要。'] },
  { keys: ['弗'], senses: ['不', '不。后面的动词常隐去宾语。'] },
  { keys: ['莫'], senses: ['没有谁；不要', '没有人，或不要。'] },
  { keys: ['微'], senses: ['如果没有；小', '如果没有。也可指微小、暗中。'] },
  { keys: ['或'], senses: ['有的人；也许', '有的、有时，或也许。'] },
  { keys: ['诸', '諸'], senses: ['之于；各位', '「之乎」或「之于」的合音。也可指各位。'] },
  { keys: ['耳'], senses: ['而已', '罢了。'] },
  { keys: ['已'], senses: ['已经；停止', '已经，或停止。'] },
  { keys: ['既'], senses: ['已经；既然', '已经。既而，是不久。'] },
  { keys: ['曾'], senses: ['曾经；竟然', '曾经，或加强否定「竟然」。'] },
  { keys: ['尝', '嘗'], senses: ['曾经', '曾经。'] },
  { keys: ['方'], senses: ['正在；将要', '正在，或将要。'] },
  { keys: ['将', '將'], senses: ['将要；带领', '将要，或带领、扶。'] },
  { keys: ['遂'], senses: ['于是', '于是、终于。'] },
  { keys: ['即'], senses: ['就；靠近', '立刻、就是，或走近。'] },
  { keys: ['因'], senses: ['于是；依靠', '于是，或凭借。'] },
  { keys: ['是'], senses: ['这', '这、此。文言里常不是判断词「是」。'] },
  { keys: ['此'], senses: ['这', '这。'] },
  { keys: ['斯'], senses: ['这', '这。'] },
  { keys: ['兹', '茲'], senses: ['这', '这、现在。'] },
  { keys: ['彼'], senses: ['那', '那、他。'] },
  { keys: ['吾'], senses: ['我', '我、我的。'] },
  { keys: ['余'], senses: ['我', '第一人称。古文里不要读成「剩余」。'] },
  { keys: ['予'], senses: ['我', '我。'] },
  { keys: ['汝'], senses: ['你', '你。'] },
  { keys: ['尔', '爾'], senses: ['你；这样', '你，或如此。'] },
  { keys: ['臣'], senses: ['我', '臣下对君的自称，也就是「我」。'] },
  { keys: ['寡人'], senses: ['我', '君主自称。'] },
  { keys: ['朕'], senses: ['我', '我。秦以后多用于皇帝。'] },
  { keys: ['孤'], senses: ['我', '诸侯自称。'] },
  { keys: ['窃', '竊'], senses: ['私下', '谦辞，私下。'] },
  { keys: ['请', '請'], senses: ['请允许我', '请你，或请允许我做。'] },
  { keys: ['敢'], senses: ['冒昧', '谦辞，冒昧地。'] },
  { keys: ['唯'], senses: ['只；应答', '只。应答时是「是」。'] },
  { keys: ['惟'], senses: ['只；思考', '只，或思考。'] },
  { keys: ['耶'], senses: ['吗；呢', '疑问语气。'] },
  { keys: ['邪'], senses: ['吗；呢', '同「耶」。'] },
  { keys: ['欤', '歟'], senses: ['吗', '疑问或感叹。'] },
  { keys: ['兮'], senses: ['啊', '句中语气，楚辞常见。'] },
  { keys: ['也者'], senses: ['判断并提示', '「也」再加「者」，先判断，再解释。'] },
  { keys: ['既而'], senses: ['不久', '过了不久。'] },
  { keys: ['已而'], senses: ['不久', '过了不久。'] },
  { keys: ['俄而'], senses: ['一会儿', '不久。'] },
  { keys: ['少顷'], senses: ['一会儿', '很短的时间。'] },
  { keys: ['未几', '未幾'], senses: ['没多久', '不久。'] },
  { keys: ['无何', '無何'], senses: ['不久', '没多久。'] },
  { keys: ['顷之', '頃之'], senses: ['不久', '过了一会儿。'] },
  { keys: ['向'], senses: ['先前；假如', '刚才、从前，或假如。'] },
  { keys: ['曩'], senses: ['从前', '过去。'] },
  { keys: ['昔'], senses: ['从前', '过去。'] },
  { keys: ['寻', '尋'], senses: ['不久', '副词，不久、随即。'] },
  { keys: ['会', '會'], senses: ['正赶上', '恰巧遇到。'] },
  { keys: ['适', '適'], senses: ['到；恰好', '往、到，或恰好。'] },
  { keys: ['属', '屬'], senses: ['恰好；连接；嘱托', '适逢，隶属，或同「嘱」。'] },
  { keys: ['比'], senses: ['及；近来', '等到，或近来。'] },
  { keys: ['及'], senses: ['到；赶上', '到、等到，或追上。'] },
  { keys: ['至'], senses: ['到', '到、到达。'] },
  { keys: ['逮'], senses: ['等到；捉', '及、等到。也可作逮捕。'] },
  { keys: ['比及'], senses: ['等到', '到了……的时候。'] },
  { keys: ['何如'], senses: ['怎么样', '如何，或与……相比怎样。'] },
  { keys: ['奈何'], senses: ['怎么办', '如何、为什么。'] },
  { keys: ['如何'], senses: ['怎么样', '怎么、为何。'] },
  { keys: ['虽然', '雖然'], senses: ['即使', '即使如此。不是现代「虽然」。'] },
  { keys: ['所以'], senses: ['……的原因', '用来……的方法，或导致……的原因。'] },
  { keys: ['以为', '以為'], senses: ['把……当作', '认为，或把甲当作乙。'] },
  { keys: ['故事'], senses: ['旧事', '旧例、旧事。不是现代小说故事。'] },
  { keys: ['往往'], senses: ['到处', '处处。'] },
  { keys: ['稍稍'], senses: ['渐渐', '逐渐。'] },
  { keys: ['不过', '不過'], senses: ['不超过', '不超过。'] },
  { keys: ['因为', '因為'], senses: ['于是做', '「因」加「为」，于是修建、于是做。'] },
  { keys: ['妻子'], senses: ['妻子和儿女', '妻与子女。'] },
  { keys: ['地方'], senses: ['土地的面积', '土地方圆。不是现代的地区。'] },
  { keys: ['其实', '其實'], senses: ['它的果实；那实际情况', '它的果实。后来也指实际情况。'] },
  { keys: ['可以'], senses: ['可以凭借', '可以用来、可以靠它。'] },
  { keys: ['交通'], senses: ['交错相通', '互相连接。'] },
  { keys: ['无论', '無論'], senses: ['不要说', '更不必说。'] },
  { keys: ['爪牙'], senses: ['勇士', '得力的武士。贬义是后起的。'] },
  { keys: ['颜色', '顏色'], senses: ['脸色', '容貌、脸色。'] },
  { keys: ['聪明', '聰明'], senses: ['听力视力', '耳聪目明。'] },
  { keys: ['卑鄙'], senses: ['地位低', '身份低微。不是品格恶劣。'] },
  { keys: ['非常'], senses: ['不寻常', '意外的变故，或极不一般。'] },
  { keys: ['牺牲', '犧牲'], senses: ['祭祀用的牲畜', '祭品。'] },
  { keys: ['亲戚'], senses: ['父母家人', '父母等亲近的人。'] },
  { keys: ['烈士'], senses: ['有志节的人', '有操守、想建功的人。'] },
  { keys: ['从容', '從容'], senses: ['举动', '举止。'] },
  { keys: ['便宜'], senses: ['方便；有利', '方便、适宜。'] },
  { keys: ['感激'], senses: ['感动奋发', '内心被打动。'] },
  { keys: ['口舌'], senses: ['言语', '说话、争辩。'] },
  { keys: ['鱼肉', '魚肉'], senses: ['欺凌', '把人当作鱼肉宰割。'] },
  { keys: ['布衣'], senses: ['平民', '没有官职的人。'] },
  { keys: ['社稷'], senses: ['国家', '土神和谷神，借指国家。'] },
  { keys: ['竖子', '豎子'], senses: ['小子', '轻蔑的称呼。'] },
  { keys: ['足下'], senses: ['您', '对对方的敬称。'] },
  { keys: ['左右'], senses: ['侍从', '身边的人。也用作对对方的敬称。'] },
  { keys: ['先生'], senses: ['年长的人', '先出生的人，老师或长者。'] },
  { keys: ['小子'], senses: ['晚辈', '自称谦辞，或称年轻人。'] },
  { keys: ['丈人'], senses: ['老人', '年长的人。'] },
  { keys: ['丈夫'], senses: ['男子', '成年男子。'] },
  { keys: ['小人'], senses: ['地位低的人', '平民，或道德上的反称。'] },
  { keys: ['君子'], senses: ['有德的人', '有地位或有德行的人。'] },
  { keys: ['百姓'], senses: ['百官；人民', '早期多指百官，后来指人民。'] },
  { keys: ['黔首'], senses: ['百姓', '平民。'] },
  { keys: ['行李'], senses: ['使者', '外交的使人。'] },
  { keys: ['山东', '山東'], senses: ['崤山以东', '战国时多指崤山以东，不是今山东省。'] },
  { keys: ['河'], senses: ['黄河', '专指黄河。'] },
  { keys: ['江'], senses: ['长江', '专指长江。'] },
  { keys: ['国', '國'], senses: ['国都；诸侯国', '国都，或封国。'] },
  { keys: ['走'], senses: ['跑', '跑。现代的「走」文言常说「行」。'] },
  { keys: ['去'], senses: ['离开', '离开。'] },
  { keys: ['行'], senses: ['走', '行走。'] },
  { keys: ['趋', '趨'], senses: ['快走', '小步快走，表示恭敬。'] },
  { keys: ['奔'], senses: ['跑', '奔跑。'] },
  { keys: ['谢', '謝'], senses: ['推辞；道歉；告别', '推辞、谢罪、告辞，或凋落。'] },
  { keys: ['汤', '湯'], senses: ['热水', '热水、开水。'] },
  { keys: ['兵'], senses: ['兵器；军队', '武器，或军队。'] },
  { keys: ['卒'], senses: ['步兵；终于', '士兵，死，或终于。'] },
  { keys: ['亡'], senses: ['逃跑；灭亡', '逃亡，失去，或灭亡。'] },
  { keys: ['池'], senses: ['护城河', '城壕。'] },
  { keys: ['爱', '愛'], senses: ['吝惜', '爱惜，或舍不得。'] },
  { keys: ['恨'], senses: ['遗憾', '不满意、懊悔。'] },
  { keys: ['涕'], senses: ['眼泪', '哭。'] },
  { keys: ['臭'], senses: ['气味', '香臭都可称臭。'] },
  { keys: ['偷'], senses: ['苟且', '马虎、得过且过。'] },
  { keys: ['贼', '賊'], senses: ['伤害', '害、作乱的人。'] },
  { keys: ['党', '黨'], senses: ['偏私', '结党、偏袒。'] },
  { keys: ['狱', '獄'], senses: ['案件', '讼案。'] },
  { keys: ['股'], senses: ['大腿', '大腿。'] },
  { keys: ['树', '樹'], senses: ['种植', '栽种，或树木。'] },
  { keys: ['再'], senses: ['两次', '第二次。'] },
  { keys: ['但'], senses: ['只', '只、仅。'] },
  { keys: ['稍'], senses: ['逐渐', '渐渐。'] },
  { keys: ['间', '間'], senses: ['偷偷地；参与；间隙', '暗中，夹杂，或缝隙。'] },
  { keys: ['说', '說'], senses: ['劝说；喜悦', '读 shuì 是劝说。也同「悦」。'] },
  { keys: ['见', '見'], senses: ['看见；被', '看见、拜见。放在动词前可表被动。'] },
  { keys: ['知'], senses: ['主持；了解', '主管，或知道。'] },
  { keys: ['善'], senses: ['擅长；友好', '善于，或与……交好。'] },
  { keys: ['疾'], senses: ['痛恨；快；病', '厌恶，快，或疾病。'] },
  { keys: ['病'], senses: ['困苦；缺点', '重病，困苦，或毛病。'] },
  { keys: ['穷', '窮'], senses: ['困窘', '走投无路，不得志。'] },
  { keys: ['伐'], senses: ['攻打；夸耀', '讨伐，或自夸。'] },
  { keys: ['侵'], senses: ['越境进攻', '不宣而战。'] },
  { keys: ['袭', '襲'], senses: ['偷袭', '乘人不备而进攻。'] },
  { keys: ['克'], senses: ['战胜', '攻下。'] },
  { keys: ['拔'], senses: ['攻下', '攻取城池。'] },
  { keys: ['举', '舉'], senses: ['占领；推荐', '拿、攻占，或荐举。'] },
  { keys: ['释', '釋'], senses: ['放下', '放开、免除。'] },
  { keys: ['置'], senses: ['放下；赦免', '搁下，或释放。'] },
  { keys: ['舍'], senses: ['放下；住宿', '舍弃，或住一宿。'] },
  { keys: ['引'], senses: ['拉；后退', '拉开弓，或退兵。'] },
  { keys: ['却', '卻'], senses: ['后退', '退。'] },
  { keys: ['御'], senses: ['驾车；抵挡', '赶车，或防御。'] },
  { keys: ['乘'], senses: ['驾车；凭借', '坐车，或趁着。'] },
  { keys: ['济', '濟'], senses: ['渡河', '渡过，或成功。'] },
  { keys: ['绝', '絕'], senses: ['横渡；断', '渡河，断绝。'] },
  { keys: ['次'], senses: ['驻扎', '临时驻军，或次序。'] },
  { keys: ['师', '師'], senses: ['军队', '军队，或老师。'] },
  { keys: ['甲'], senses: ['铠甲', '盔甲，或士兵。'] },
  { keys: ['归', '歸'], senses: ['回；出嫁', '返回。女子出嫁也说归。'] },
  { keys: ['诣', '詣'], senses: ['到', '前往拜访。'] },
  { keys: ['造'], senses: ['到', '前往。'] },
  { keys: ['如'], senses: ['到；像；如果', '往，如同，或假如。'] },
  { keys: ['岁', '歲'], senses: ['年', '年成，或年龄。'] },
  { keys: ['期'], senses: ['约定；满一年', '约会，或一周年。'] },
  { keys: ['业', '業'], senses: ['已经', '副词，已经。'] },
  { keys: ['且夫'], senses: ['再说', '句首，推进一层。'] },
  { keys: ['若夫'], senses: ['至于', '转而说到另一事。'] },
  { keys: ['然则', '然則'], senses: ['既然这样，那么', '那么。'] },
];

const MAX_WORD = 6;

function indexEntries(entries: readonly LexiconEntry[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const entry of entries) {
    const senses = entry.senses.map((sense) => sense.trim()).filter(Boolean);
    if (senses.length === 0) continue;
    for (const key of entry.keys) {
      const word = key.trim();
      if (word) map.set(word, senses);
    }
  }
  return map;
}

const bundled = indexEntries(CLASSICAL_LEXICON);

/**
 * Longest lexicon word covering `index` in `text`.
 * `extra` entries override the bundled gloss for the same key.
 */
export function lookupClassical(text: string, index: number, extra: readonly LexiconEntry[] = []): GlossHit | null {
  if (!text) return null;
  const map = extra.length > 0 ? indexEntries([...CLASSICAL_LEXICON, ...extra]) : bundled;
  const at = Math.max(0, Math.min(text.length - 1, index));
  let best: GlossHit | null = null;
  for (let start = Math.max(0, at - MAX_WORD + 1); start <= at; start += 1) {
    const room = Math.min(MAX_WORD, text.length - start);
    for (let length = room; length >= 1; length -= 1) {
      if (start + length <= at) break;
      if (best && length <= best.word.length) break;
      const word = text.slice(start, start + length);
      const senses = map.get(word);
      if (senses) best = { word, senses };
    }
  }
  return best;
}
