# ScratchDream — Kurulum (Chrome eklentisi)

**Hayal ettiklerin Scratch'te olsun.**

Kostüm editörüne **ayrı bir vektör piksel editörü**, şekiller, basınçlı kalem,
maske / karışım / şeffaf PNG, katman şeridi, çok duraklı gradyan, **animasyon ekseni**
ve **plan tahtası** ekler. **scratch.mit.edu**, **turbowarp.org** ve **penguinmod.com**
editöründe aynı kod çalışır.

## Kurulum

1. Adres çubuğuna `chrome://extensions` yaz, Enter'a bas.
2. Sağ üstteki **Geliştirici modu** anahtarı açık olsun.
3. Sol üstteki **Paketlenmemiş öğe yükle** düğmesine bas.
4. Bu depodaki **extension** klasörünü seç (dosya değil):

   ```
   ScratchDream\extension
   ```

5. Listede **ScratchDream** görünsün.
6. Editör sekmesi açıksa **F5** ile yenile.

## Eklenti paneli

Tarayıcının köşesindeki ScratchDream simgesine tıkla. Panelde dokuz satır, bir arama
çubuğu ve beş kategori düğmesi var. Panel **420** piksel genişliğinde; Chrome'un 600
piksel sınırının altında kaldığı için kaydırman gerekmez. Sürüm etiketi doğrudan
`manifest.json`'dan okunur, bu yüzden elle güncellenmez.

| Kategori | Araç | Kısayol |
|---|---|---|
| Çizim | **Vektör pikselleme** — piksel sanatı, bulanıklık yok | `Alt+P` |
| Çizim | Şekil araçları — 31 şekil | — |
| Çizim | Kalem ve uçlar — 11 uç + basınç | `[` `]`, `Alt+tekerlek` |
| Çizim | Animasyon ekseni | `Alt+D` |
| Paneller | Katman şeridi | — |
| Paneller | Maske ve karışım — 16 mod, şeffaf PNG | `Alt+M` `Alt+B` `Alt+X` |
| Paneller | **Plan tahtası** — proje kartları | — |
| Renk | Degrade durakları — 3 ve 4 durak | — |
| Hız | Yük diyeti — boşta yavaş yoklama, analitik engeli | — |

- Karoya nereden tıklarsan anahtar döner; kapalı karo bütünüyle solar.
- `9 / 9 açık` satırı dürüsttür: kaç aracın açık olduğunu söyler.
- **Hepsini kapat** tek hamlede dokuzunu kapatır, aynı düğme tekrar açar.
- Kapattığın araç açık sekmelerde anında kaybolur; ayar tarayıcıda saklanır.
- Arama ve sekmeler aynı listeyi süzer; eşleşme yoksa "Eşleşen yok." yazar.

## Editörde ne çıkar

Kostüm sekmesinde, sol araç sütununun **altında dört düğme** belirir:

- **üçgen + daire** → Şekiller
- **kalem ucu** → ScratchDream kalemi
- **iki kesişen daire** → Gelişmiş (maske, karışım, PNG)
- **artı/nişan** → Animasyon ekseni

Vektör pikselleme araç sütununda değildir: tuvalin altındaki **Convert to Bitmap /
Convert to Vector** düğmelerinin hemen yanında üçüncü seçenek olarak durur.

Kostüm başlığının sağ üstündeki boşlukta, editörün kendi renginde küçük bir
**plan tahtası** düğmesi durur.

Fırça veya Silgi'ye dokununca uç kutusu kendiliğinden açılır; tuvale dokunup çizmeye
başladığın an kapanır (fırçaya bir daha dokunursan tekrar açılır). Katman listesi tuvalin
**sağ kenarındaki ince şerittir**; üstüne gelince açılır, **Açık tut** ile sabitlenir.

## Vektör pikselleme (ayrı mod)

Bir araç kutusu değil, ayrı bir çalışma modu. Dönüştürme düğmelerinin yanındaki
**Vector bitmapping / Vektör pikselleme** düğmesine bas (`Alt+P`); editörün üstünde kendi penceresi açılır.
Mevcut tuvale sıkışmaz, editörü bozmaz.

- Bitmap kostümde önce **vektöre çevrilir**, sonra editör açılır. Üçüncü seçenek
  baştan vektör tabanlıdır: çıktı her zaman vektördür, bitmap değildir.
- **Bulanıklık yok:** çıktı, her rengin dikdörtgen vektör kareleri olarak yazılır.
  Pikseller yerinde kalır; sprite sahnede büyütülse de Scratch onları bulanıklaştırmaz.
  Pixel Studio ve Aseprite’daki sert piksel görünümü korunur.
- Tuval tam piksel ızgarasıdır. Her hamle tam pikseldir; yarım piksele düşme ve iki
  yanda yarı saydam taşma oluşamaz.
- **Dokuz araç:** fırça (varsayılan, **dolu** boyar), kalem, silgi, doldur, çizgi,
  dikdörtgen, elips, renk al, çizimi taşı.
- **Boyut** 1–8; **Şekiller dolu** ve **Piksel ızgarası** varsayılan açık.
- Renk kutusu ve çizimden çıkarılan 10 renklik palet.
- **Geri al / İleri al** düğmeleri; `Ctrl+Z` / `Ctrl+Shift+Z`. Ok tuşları çizimi
  bir piksel kaydırır. `+` / `−` yakınlaştırır, **Sığdır** pencereye oturtur.
- **Yumuşak kenarları düzelt** açıkken açılışta ve uygulamada otomatik çalışır:
  görünmez alfa 0'a, opak çekirdek 255'e sabitlenir; en az iki boş komşusu olan
  yarı saydam halka silinir. Kaç kenar pikselinin temizlendiği altta yazar.
- **Vektör olarak uygula:** her renk için tek bir vektör yol yazar; aynı renkteki
  yatay piksel koşuları tek yolda birleşir. Kostüm kapatılıp açılsa da vektör kalır.
- **Vazgeç** veya `Esc` hiçbir şey yazmadan kapatır. Yazma tek adımdır; editörün
  kendi `Ctrl+Z`'si bütün uygulamayı geri alır.

## Bitmap'e çevirirken keskinlik

Yerleşik **Convert to Bitmap** düğmesi vektör çizimi 960×720 tuvale yumuşak kenarlarla
çevirir; yakınlaştırınca bulanıklık ve ince çizgilerde kesik kesik görünüm oluşur.
Piksel özelliği açıkken eklenti dönüşüm bitince kendi **piksel ızgarasını** seçer:

- **Oran, çizimin en ince hattına göre** ölçülür: iki eksende renk geçişlerinin alt
  çeyreği hat kalınlığı sayılır. Hat inceyse (bir kostüm biriminden az) **1:1** —
  hiç yeniden örnekleme yapılmaz; hat kalınsa **2×2** — bir kostüm birimi bir piksel
  olur. Kostüm tuvale her zaman 2× içe aktarıldığı için iki oran da tam oturur;
  3×3 veya 4×4 kaynak ızgarada karşılığı olmadığı için kullanılmaz.
- Yarı saydam kenarlar **0 veya 255** olur; artıklar (tek başına kalan soluk halka)
  silinir.
- 1:1'de ayrıca **renk karışımları palete geri çekilir**: palet yalnızca düz iç
  piksellerden kurulur, böylece anti-aliasing karışımı palete sızmaz. Bir piksel
  %35'ten fazla hattaysa hat rengini korur — bu, ince çizginin noktaya dönüşmesini
  engelleyen kuraldır (Inglis & Kaplan'ın çizgi sanatı pikselleştiricisi gibi).

Ölçülen sonuç: 480×360, 1.4 birimlik çizgili test kostümü → **1:1**, raster 364
renkten **3 renge** indi, 4× yakınlaştırmada çizgiler kesintisiz ve sert. Kalın
çizgili kedi kostümü → **2×2**.

- Dönüşümden sonra altta **"Bitmap 1:1 oranında keskinleştirildi"** yazar.
- İstemezsen araç çubuğundan **Vektör pikselleme** anahtarını kapat; dönüşüm eski
  yumuşak hâline döner.
- Sıra: **Vector bitmapping** solda, **Convert to Bitmap / Convert to Vector** sağda,
  aralarında boşluk var.

## Plan tahtası

Blok üretimi (eski Magic Code) tamamen kaldırıldı. Yerine editörün içinde bir **plan
tahtası** var:

- Varsayılan üç sütun: **Yapılacak / Yapılıyor / Bitti**.
- **+ Kart ekle** ile kart aç; başlık ve not alanı doğrudan yazılır.
- Kartı **üst çubuğundan** tutup başka sütuna sürükle.
- Sütun adı kutusundan adı değiştir; çöp kutusu sütunu siler (kartlar ilk sütuna taşınır).
- Üstteki **+** yeni sütun açar; sütunlar panelin genişliğini paylaşır.
- **Dışa aktar** `scratchdream-board.json` indirir; **İçe aktar** aynı dosyayı geri yükler.
- Notlar `localStorage`'da, tarayıcıda saklanır — **proje dosyasına yazılmaz**. Başka
  bilgisayarda görmek için dışa aktar / içe aktar.

Kapatıp açtığında kartlar yerinde durur. Gizli bilgi saklanmaz; ağa hiçbir şey gitmez.

## Animasyon ekseni

Kostüm değişince çizim sahnede kayıyorsa eksenler ayrı yazılmıştır. `Alt+D`:

1. Kutu her kostümün çizimini ölçer, **sıçrama (px)** değerini verir.
2. Üç plan: **Ortak gövde noktası**, **Kendi merkezi**, **İlkine göre**.
3. **Eksenleri düzelt** kaydeder; **Geri al** eski değerleri yazar.
4. Her satırda kostümün küçük çizimi, adı ve `eski → yeni` ekseni durur.

Değer yalnız kayıt seviyesinde yazılır: çizim, katmanlar ve dosya boyutu değişmez.
Tek kostümde kutu bunu söyler; boş kostüm atlanır.

## Gelişmiş kutusu

Tuvalde şekil seç, sonra düğmeye bas (yoksa düğmeler soluk ve nedenini yazar):

- **Maske / Bırak:** en üstteki seçim makas olur, altındakiler yalnız onun içinde görünür.
- **Karışım (16 mod):** normal, multiply, screen, overlay, darken, lighten, color dodge,
  color burn, hard light, soft light, difference, exclusion, hue, saturation, color,
  luminosity. `Alt+B` ileri, `Alt+Shift+B` geri.
- **Sivri köşe:** kalın konturda uzayan köşeyi kısaltır; `Alt+J` = 1.2.
- **PNG (1× / 2× / 4×):** kostümü şeffaf zeminli PNG olarak indirir; `Alt+X`.
- Bitmap kostümde maske/karışım vektör şekil ister; PNG yine çalışır.

## Katman şeridi

Tuvalin sağ kenarındaki şerit; üstüne gelince açılır, **Açık tut** ile sabitlenir.

- Satıra tıkla → nesne seçilir; `Shift` / `Ctrl` ile çoklu seçim.
- **Göz** gizler (dosyada `visibility="hidden"` kalır), **kilit** seçimi engeller.
- **Ad** SVG `id` olur; çift tıkla adlandır.
- Dört ok sırayı değiştirir (En Öne / Bir Öne / Bir Arkaya / En Arkaya).
- Çoğalt, sil, altı yönlü hizala, ±90° döndür, saydamlık.

## Kısayollar

| Tuş | İş |
|---|---|
| `[` / `]` | ucu incelt / kalınlaştır |
| Alt + fare tekerleği | kalınlık |
| Alt+P | vektör pikselleme editörünü aç |
| Alt+D | animasyon ekseni (açıkken planı uygular) |
| Alt+M | maske |
| Alt+B / Alt+Shift+B | sıradaki / önceki karışım |
| Alt+J | sivri köşe 1.2 |
| Alt+X | şeffaf PNG |
| Esc | önce paneli, sonra aracı bırakır |
| Ctrl+Z | editörün kendi geri alı |

## Güncelleme

`chrome://extensions` → ScratchDream → **↻** → editör sekmesinde **F5**.
Sürüm `manifest.json` içindeki `version` alanından gelir.

## Notlar

- Editör **içindeki** kutular marka teması dayatmaz: zemin, metin, vurgu ve köşe ölçüsü
  editörün kendi CSS'inden okunur (koyu tema dahil). Araç çubuğu paneli v9 tasarımıdır
  ve sistem koyu moduna uyar.
- Piksel editörü çizimi **vektör yollarına** yazar; bitmap çıktı üretmez. Çok renkli
  bir kostümde renk başına bir yol oluşur (piksel başına bir nesne değil).
- Yumuşak kenar düzeltmesi **alfa** değerlerini ve yarı saydam halkayı temizler;
  çizimin rengini değiştirmez. Vektörden rasterleşen kenarlarda anti-aliasing
  karışım renkleri kalabilir; bu, piksel sanatında beklenen sert kenardır.
- Bitmap kostümde editör önce vektöre çevirir; bu dönüşüm editörün kendi geri-al
  yığınına bağlıdır, ayrı yedek tutulmaz.
- Piksel ızgarası 4× ve üzerinde çizilir; çok uzaklaştırınca gizlenir.
- Plan tahtası proje dosyasına yazılmaz; tarayıcı deposundadır.
- Karışım modu kostüm SVG'sinde `mix-blend-mode` olarak durur; editörde görünür,
  eski sahne çizicisi bu satırı yok sayabilir.
- **Magic Code kaldırıldı (v2.0.0).** `extension/magic/`, `mcp-server/` ve AI anahtarı
  izinleri yok. Eklenti hiçbir sunucuya bağlanmaz; istediği iki izin `storage`
  (ayarları saklamak) ve `declarativeNetRequest` (analitik isteklerini kesmek).
  Site içeriğine erişim izni istemez.
- **Piksel modu ayrıldı (v2.1.0).** Eski araç-sütunu kutusu kaldırıldı; yerine dönüştürme
  satırından açılan, vektör yazan ayrı piksel editörü geldi.
- **Yük diyeti eklendi (v2.2.0).** Boşta 1400 ms'e çıkan, editör kapalıyken 2000 ms'e inen ve
  arka plan sekmesinde hiç çalışmayan yoklama döngüsü; ayrıca kesilen analitik istekleri. Anahtar
  kapanınca ruleset de kapanır ve düz 900 ms'lik yoklama geri gelir. İki deneme ölçümde elendi:
  (1) kalem sürerken boyamayı kare başına bire indiren sarma — Chrome hızlı hareketleri sayfaya
  ulaştırmadan zaten kare başına bir olaya katlıyor (tek demette gönderilen 60 hareket sayfaya
  5-11 olay olarak ulaştı, 61 alt olay katlanmıştı), sarma kırpacak ikinci boyama bulamıyordu;
  (2) sayfa donduğunda kenara çekilen şerit — boşta 1400 ms uyuyan döngüyü 400 ms'e çekip
  kilitlenme sırasında daha gürültülü yapıyordu. İkisi de kaldırıldı.
- **Uç kutusu çizimi yemiyor (v2.2.0).** Fırça/Silgi tıklamasıyla açılan uç kutusu tuvalin sol
  yarısının üstünde duruyordu; ölçüm 17 satırın 14'ünde kalemin panele indiğini ve vuruşun
  kaybolduğunu gösterdi. İki şey yapıldı: kutu artık tuvalin üstüne hiç yerleşmiyor (örtüşme
  Türkçe düzende tuval alanının %4,9'u, Arapça düzende %5,0'i; yer kalmayınca butona en yakın
  boş kenar seçiliyor) ve tuvale inen ilk işaretçi kutuyu kapatıyor. Kanıt Türkçe ve Arapça
  editörde canlı koşuldu: kutu AÇIKken kalemin altında `paper-canvas` var, vuruş modelde yer
  bırakıyor.
- **Editörün diliyle konuşuyor.** Editör Türkçe açılıyorsa kendi kutularımızın etiketleri de
  Türkçe; Arapça açılıyorsa kutular aynalanıp sağdan diziliyor. İkisi de canlı editörde
  doğrulandı: `node dev/probes/_locale.mjs` → 12/12. Ürün kodu hiçbir yerde çevrilmiş buton
  yazısına bakmıyor, o yüzden dil değişince hiçbir araç sapıtmıyor.
- Script yalnız Chrome eklentisi olarak yüklenir; Tampermonkey başlığı kaldırıldı,
  çünkü eşleşen adres listesi manifestin gerisinde kalmıştı.
