
<h2>Selected Publications 
<!-- <temp style="font-size:16px;">[</temp><a href="https://scholar.google.com/citations?user=m674z14AAAAJ" target="_blank" style="font-size:15px;">Google Scholar</a><temp style="font-size:16px;">]</temp><temp style="font-size:15px;">[</temp><a href="https://dblp.uni-trier.de/pid/12/10033-1.html" target="_blank" style="font-size:15px;">DBLP</a><temp style="font-size:15px;">]</temp> -->
</h2>
<!-- (<span style="font-size= 1.5em"> * refers to the students I have advised or co-advised, <i class="fa-regular fa-envelope fa-xs"></i> indicates the corresponding author</span>) -->

(<span style="font-size= 1.5em"> * refers to the students I have advised or co-advised, <i class="fa-regular fa-envelope fa-xs"></i> indicates the corresponding author</span>)

<!-- <h3><span style="font-size: auto">&middot;</span>&nbsp;Conference Papers</h3> -->
<div class="publications">
<ol class="bibliography">

{% for link in site.data.publications.conference%}

<li>
<div class="pub-row">
  <div class="col-sm-3 abbr" style="position: relative;padding-right: 15px;padding-left: 15px;">
    <img src="{{ link.image }}" class="teaser img-fluid z-depth-1" style="width=100;height=40%;object-fit:scale-down">
            <abbr class="badge">{{ link.article_short }}</abbr>
  </div>
  <div class="col-sm-9" style="position: relative;padding-right: 15px;padding-left: 20px;">
      <div class="title"><a href="{{ link.pdf }}">{{ link.title }}</a></div>
      <div class="author">{{ link.authors }}</div>
      <div class="periodical"><em>{{ link.article }}</em>
      </div>
    <div class="links">
      {% if link.pdf %} 
      <a href="{{ link.pdf }}" class="btn btn-sm z-depth-0" role="button" target="_blank" style="font-size:12px;">PDF</a>
      {% endif %}
      {% if link.code %} 
      <a href="{{ link.code }}" class="btn btn-sm z-depth-0" role="button" target="_blank" style="font-size:12px;">Code</a>
      {% endif %}
      {% if link.page %} 
      <a href="{{ link.page }}" class="btn btn-sm z-depth-0" role="button" target="_blank" style="font-size:12px;">Project Page</a>
      {% endif %}
      {% if link.bibtex %} 
      <a href="{{ link.bibtex }}" class="btn btn-sm z-depth-0" role="button" target="_blank" style="font-size:12px;">BibTex</a>
      {% endif %}
      {% if link.notes %} 
      <strong> <i style="color:#e74d3c">{{ link.notes }}</i></strong>
      {% endif %}
      {% if link.others %} 
      {{ link.others }}
      {% endif %}
    </div>
  </div>
</div>
</li>

<br>

{% endfor %}

</ol>
</div>

<!-- <h3><span style="font-size: auto">&middot;</span>&nbsp; Journal Papers</h3> -->

<!-- <div class="publications">
<ol class="bibliography">

<li>
<div class="pub-row">
  <div class="col-sm-3 abbr" style="position: relative;padding-right: 15px;padding-left: 15px;">
    <img src="https://img.yliu.me/teaser/MTL_CVPR.png" class="teaser img-fluid z-depth-1">
            <abbr class="badge">CVPR</abbr>
  </div>
  <div class="col-sm-9" style="position: relative;padding-right: 15px;padding-left: 20px;">
      <div class="title"><a href="https://openaccess.thecvf.com/content_CVPR_2019/html/Sun_Meta-Transfer_Learning_for_Few-Shot_Learning_CVPR_2019_paper.html">Meta-Transfer Learning for Few-Shot Learning</a></div>
      <div class="author">Qianru Sun*, <strong>Yaoyao Liu*</strong>, Tat-Seng Chua, Bernt Schiele <br> (* Equal contribution)</div>
      <div class="periodical"><em>IEEE/CVF Conference on Computer Vision and Pattern Recognition <strong>(CVPR)</strong>, 2019.</em>
      </div>
    <div class="links">
      <a href="https://openaccess.thecvf.com/content_CVPR_2019/papers/Sun_Meta-Transfer_Learning_for_Few-Shot_Learning_CVPR_2019_paper.pdf" class="btn btn-sm z-depth-0" role="button" target="_blank" style="font-size:12px;">PDF</a>
      <a href="https://github.com/yaoyao-liu/meta-transfer-learning" class="btn btn-sm z-depth-0" role="button" target="_blank" style="font-size:12px;">Code</a>
      <a href="https://lyy.mpi-inf.mpg.de/mtl/" class="btn btn-sm z-depth-0" role="button" target="_blank" style="font-size:12px;">Project Page</a>
      <a href="https://dblp.uni-trier.de/rec/conf/cvpr/SunLCS19.html?view=bibtex" class="btn btn-sm z-depth-0" role="button" target="_blank" style="font-size:12px;">BibTex</a>
<br>
<strong> <a style="color:#e74d3c; font-weight:600" href="https://scholar.google.com/citations?view_op=view_citation&hl=en&user=Uf9GqRsAAAAJ&citation_for_view=Uf9GqRsAAAAJ:bEWYMUwI8FkC"><i id="total_citation_mtl">800+</i><i style="color:#e74d3c; font-weight:600"> Citations • </i></a><a href="https://github.com/yaoyao-liu/meta-transfer-learning" target="_blank" rel="noopener"><i style="color:#e74d3c; font-weight:600" id="githubstars_mtl">600+</i><i style="color:#e74d3c; font-weight:600"> GitHub Stars</i></a> <a style="color:#e74d3c; font-weight:600" href="https://www.comp.nus.edu.sg/news/archives/y2019/2019-cvpr-research/">• <i>Featured in NUS News</i></a></strong>
<br>
<strong><a style="color:#e74d3c; font-weight:600" href="https://scholar.google.com/citations?hl=en&view_op=list_hcore&venue=FXe-a9w0eycJ.2023&vq=en&cstart=100"><i>Top 120 Most Cited CVPR Papers over the Last Five Years</i></a></strong>
  <script>
  githubStars("yaoyao-liu/meta-transfer-learning", function(stars) {
  var startext = document.getElementById("githubstars_mtl");
        startext.innerHTML=stars;
  });
  </script>
  <script>
      $(document).ready(function () {
          
          var gsDataBaseUrl = 'https://raw.githubusercontent.com/yaoyao-liu/yaoyao-liu.github.io/'
          
          $.getJSON(gsDataBaseUrl + "google-scholar-stats/gs_data.json", function (data) {
              var totalCitation = data['publications']['Uf9GqRsAAAAJ:bEWYMUwI8FkC']['num_citations']
              document.getElementById('total_citation_mtl').innerHTML = totalCitation;
              var citationEles = document.getElementsByClassName('show_paper_citations')
              Array.prototype.forEach.call(citationEles, element => {
                  var paperId = element.getAttribute('data')
                  var numCitations = data['publications'][paperId]['num_citations']
                  element.innerHTML = '| Citations: ' + numCitations;
              });
          });
      })
  </script>
    </div>
  </div>
</div>
</li>

</ol>
</div> -->


