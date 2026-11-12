/* Built-in samples, in the EXACT shape the backend returns (see api/frontend-handoff.md).
   Used for "Try a sample" and when PLAINLY_CONFIG.USE_MOCK is true.
   Each sample keeps its notice text so it can also be sent to the real backend to translate. */
(function () {
  // Build one backend-shaped response from the English part + one translation.
  function notice(en, tr) {
    tr = tr || { summary: en.summary, checklist: en.checklist };
    return {
      title: en.title,
      sender: en.sender,
      summary: en.summary,
      deadlines: en.deadlines,
      checklist: en.checklist,
      translated_summary: tr.summary,
      translated_checklist: tr.checklist,
      translated_instructions: tr.instructions || tr.checklist.join("\n"),
      uncertainties: en.uncertainties
    };
  }

  /* ---------- 1. School vaccine notice ---------- */
  const schoolText = `Riverside Unified School District, Office of Student Health Services

Dear Parent/Guardian,

Pursuant to California Health and Safety Code §120325–120375, all students entering or advancing to the 7th grade must present documentation of a tetanus, reduced diphtheria and acellular pertussis (Tdap) booster immunization. Our records indicate that your student's immunization file is incomplete.

Documentation must be received by the school health office no later than Friday, December 5, 2026. Acceptable documentation includes a California School Immunization Record (blue card) or a signed record from a licensed healthcare provider.

Students without compliant documentation will be excluded from attendance beginning January 6, 2027, until such documentation is provided. Exclusion days are recorded as unexcused absences.

The district will host a no-cost immunization clinic on Saturday, November 21, 2026, 9:00 a.m.–1:00 p.m., in the Riverside Middle School gymnasium. Consent form HS-12 must be completed and signed by the parent/guardian prior to vaccination.

Records may be submitted in person or electronically via the ParentPortal under Health > Documents. Please direct inquiries to the Health Office at (555) 210-4400.`;

  const schoolEn = {
    title: "Your child's school needs proof of a Tdap vaccine for 7th grade.",
    sender: "Riverside Unified School District, Office of Student Health Services",
    summary: "The school doesn't have a record that your 7th grader got the Tdap booster shot. Turn in proof by December 5, 2026, or your child can't attend school starting January 6, 2027. A free vaccine clinic is on November 21 at Riverside Middle School.",
    deadlines: [
      { action: "Turn in proof of the Tdap vaccine", when: "no later than Friday, December 5, 2026", source_quote: "Documentation must be received by the school health office no later than Friday, December 5, 2026.", date: "2026-12-05" },
      { action: "Sign consent form HS-12 if your child will get the shot at the clinic", when: "prior to vaccination", source_quote: "Consent form HS-12 must be completed and signed by the parent/guardian prior to vaccination.", date: null }
    ],
    checklist: [
      "Find your child's blue vaccine card (California School Immunization Record), or ask their doctor for a signed vaccine record.",
      "If your child hasn't had the Tdap shot, sign consent form HS-12.",
      "If your child needs the shot, go to the free clinic on Saturday, November 21, 9 AM to 1 PM, in the Riverside Middle School gym.",
      "Turn in the vaccine record by Friday, December 5, 2026, at the health office or on ParentPortal under Health > Documents."
    ],
    uncertainties: []
  };
  const schoolTr = {
    Spanish: {
      summary: "La escuela no tiene registro de que su estudiante de 7.º grado recibió la vacuna de refuerzo Tdap. Entregue la prueba a más tardar el 5 de diciembre de 2026, o su hijo no podrá asistir a la escuela a partir del 6 de enero de 2027. Habrá una clínica de vacunas gratuita el 21 de noviembre en Riverside Middle School.",
      checklist: [
        "Busque la tarjeta azul de vacunas de su hijo (California School Immunization Record), o pida a su médico un registro de vacunas firmado.",
        "Si su hijo no ha recibido la vacuna Tdap, firme el formulario de consentimiento HS-12.",
        "Si su hijo necesita la vacuna, vaya a la clínica gratuita el sábado 21 de noviembre, de 9 a. m. a 1 p. m., en el gimnasio de Riverside Middle School.",
        "Entregue el registro de vacunas a más tardar el viernes 5 de diciembre de 2026, en la oficina de salud o en ParentPortal, en Health > Documents."
      ]
    },
    Vietnamese: {
      summary: "Trường chưa có hồ sơ cho thấy con bạn học lớp 7 đã tiêm mũi nhắc Tdap. Hãy nộp giấy chứng nhận chậm nhất ngày 5 tháng 12 năm 2026, nếu không con bạn sẽ không được đi học từ ngày 6 tháng 1 năm 2027. Có buổi tiêm miễn phí ngày 21 tháng 11 tại Riverside Middle School.",
      checklist: [
        "Tìm thẻ tiêm chủng màu xanh của con (California School Immunization Record), hoặc xin bác sĩ hồ sơ tiêm chủng có chữ ký.",
        "Nếu con chưa tiêm Tdap, hãy ký mẫu đồng ý HS-12.",
        "Nếu con cần tiêm, hãy đến buổi tiêm miễn phí vào thứ Bảy, 21 tháng 11, từ 9 giờ sáng đến 1 giờ chiều, tại phòng thể dục trường Riverside Middle School.",
        "Nộp hồ sơ tiêm chủng chậm nhất thứ Sáu, ngày 5 tháng 12 năm 2026, tại phòng y tế hoặc trên ParentPortal mục Health > Documents."
      ]
    },
    "Simplified Chinese": {
      summary: "学校没有您七年级孩子接种 Tdap 加强针的记录。请在 2026 年 12 月 5 日之前提交证明，否则从 2027 年 1 月 6 日起孩子不能上学。11 月 21 日在 Riverside Middle School 有免费疫苗接种。",
      checklist: [
        "找到孩子的蓝色疫苗卡（California School Immunization Record），或请医生提供签名的疫苗记录。",
        "如果孩子还没有接种 Tdap，请签署 HS-12 同意书。",
        "如果孩子需要接种，请于 11 月 21 日星期六上午 9 点到下午 1 点前往 Riverside Middle School 体育馆参加免费接种。",
        "在 2026 年 12 月 5 日星期五之前，把疫苗记录交到健康办公室，或上传到 ParentPortal 的 Health > Documents。"
      ]
    },
    Tagalog: {
      summary: "Walang rekord ang paaralan na nakuha ng iyong anak sa ika-7 baitang ang Tdap booster. Ibigay ang patunay hanggang Disyembre 5, 2026, o hindi makakapasok ang iyong anak simula Enero 6, 2027. May libreng bakunahan sa Nobyembre 21 sa Riverside Middle School.",
      checklist: [
        "Hanapin ang asul na vaccine card ng iyong anak (California School Immunization Record), o humingi sa doktor ng pinirmahang rekord ng bakuna.",
        "Kung hindi pa nakakakuha ng Tdap ang iyong anak, pirmahan ang consent form HS-12.",
        "Kung kailangan ng bakuna, pumunta sa libreng bakunahan sa Sabado, Nobyembre 21, 9 AM hanggang 1 PM, sa gym ng Riverside Middle School.",
        "Ibigay ang rekord ng bakuna hanggang Biyernes, Disyembre 5, 2026, sa health office o sa ParentPortal sa Health > Documents."
      ]
    },
    Arabic: {
      summary: "لا تملك المدرسة سجلًا يثبت أن طفلك في الصف السابع أخذ الجرعة المعززة Tdap. سلّم الإثبات في موعد أقصاه 5 ديسمبر 2026، وإلا فلن يتمكن طفلك من حضور المدرسة ابتداءً من 6 يناير 2027. توجد عيادة تطعيم مجانية يوم 21 نوفمبر في Riverside Middle School.",
      checklist: [
        "ابحث عن كرت التطعيم الأزرق لطفلك (California School Immunization Record)، أو اطلب من الطبيب سجل تطعيم موقّعًا.",
        "إذا لم يأخذ طفلك لقاح Tdap، وقّع نموذج الموافقة HS-12.",
        "إذا احتاج طفلك اللقاح، اذهب إلى العيادة المجانية يوم السبت 21 نوفمبر من 9 صباحًا حتى 1 ظهرًا في صالة Riverside Middle School.",
        "سلّم سجل التطعيم في موعد أقصاه الجمعة 5 ديسمبر 2026 في مكتب الصحة أو على ParentPortal في Health > Documents."
      ]
    }
  };

  /* ---------- 2. Food benefits renewal ---------- */
  const benefitsText = `Harbor County Department of Social Services

NOTICE OF RECERTIFICATION REQUIREMENT

Your household's food assistance benefits are scheduled for recertification. To continue receiving benefits, you must complete the enclosed Recertification Form RC-2 and provide verification of all household income received in the past 30 days.

All required documents must be received by November 30, 2026. Documents may be submitted online or by mail.

A telephone interview on Tuesday, November 24, 2026 at 10:30 a.m. has been scheduled. Failure to complete the interview may result in denial of your recertification.

If the recertification process is not completed, your benefits will be discontinued effective December 31, 2026.

You are required to report changes in income, address, or household composition within ten (10) days of the change. Questions: (555) 301-7700.`;

  const benefitsEn = {
    title: "It's time to renew your food assistance benefits.",
    sender: "Harbor County Department of Social Services",
    summary: "Your food assistance needs to be renewed. Fill out Form RC-2, send proof of your household income from the last 30 days, and do a phone interview. If you don't finish by the deadlines, your benefits stop on December 31, 2026.",
    deadlines: [
      { action: "Be available for the phone interview", when: "Tuesday, November 24, 2026 at 10:30 a.m.", source_quote: "A telephone interview on Tuesday, November 24, 2026 at 10:30 a.m. has been scheduled.", date: "2026-11-24" },
      { action: "Send Form RC-2 and proof of income", when: "by November 30, 2026", source_quote: "All required documents must be received by November 30, 2026.", date: "2026-11-30" },
      { action: "Report changes in income, address or household", when: "within ten (10) days of the change", source_quote: "You are required to report changes in income, address, or household composition within ten (10) days of the change.", date: null }
    ],
    checklist: [
      "Fill out and sign Recertification Form RC-2.",
      "Gather proof of all household income from the past 30 days.",
      "Answer the phone interview on Tuesday, November 24, 2026 at 10:30 a.m.",
      "Send the form and proof of income online or by mail so they arrive by November 30, 2026.",
      "Report any change in income, address or household within 10 days of the change."
    ],
    uncertainties: [
      "The letter doesn't say how to reschedule the phone interview if you can't make it. Call (555) 301-7700 to ask.",
      "The letter says documents can be sent online but doesn't give the website."
    ]
  };
  const benefitsTr = {
    Spanish: {
      summary: "Su ayuda para comida tiene que renovarse. Llene el formulario RC-2, envíe prueba de los ingresos de su hogar de los últimos 30 días y haga una entrevista por teléfono. Si no termina antes de las fechas límite, sus beneficios se terminan el 31 de diciembre de 2026.",
      checklist: [
        "Llene y firme el formulario de recertificación RC-2.",
        "Junte prueba de todos los ingresos de su hogar de los últimos 30 días.",
        "Conteste la entrevista por teléfono el martes 24 de noviembre de 2026 a las 10:30 a. m.",
        "Envíe el formulario y la prueba de ingresos por internet o por correo para que lleguen a más tardar el 30 de noviembre de 2026.",
        "Reporte cualquier cambio de ingresos, dirección o personas del hogar dentro de los 10 días del cambio."
      ]
    },
    Vietnamese: {
      summary: "Trợ cấp thực phẩm của bạn cần được gia hạn. Hãy điền mẫu RC-2, gửi giấy tờ chứng minh thu nhập của gia đình trong 30 ngày qua và làm phỏng vấn qua điện thoại. Nếu không hoàn tất trước hạn, trợ cấp sẽ dừng vào ngày 31 tháng 12 năm 2026.",
      checklist: [
        "Điền và ký mẫu gia hạn RC-2.",
        "Gom giấy tờ chứng minh mọi thu nhập của gia đình trong 30 ngày qua.",
        "Nghe cuộc phỏng vấn qua điện thoại vào thứ Ba, ngày 24 tháng 11 năm 2026 lúc 10:30 sáng.",
        "Gửi mẫu đơn và giấy tờ thu nhập qua mạng hoặc qua bưu điện để đến nơi chậm nhất ngày 30 tháng 11 năm 2026.",
        "Báo mọi thay đổi về thu nhập, địa chỉ hoặc người trong nhà trong vòng 10 ngày kể từ khi thay đổi."
      ]
    },
    "Simplified Chinese": {
      summary: "您的食品补助需要续办。请填写 RC-2 表格，提交家庭最近 30 天的收入证明，并完成电话面试。如果没有在截止日期前完成，补助将于 2026 年 12 月 31 日停止。",
      checklist: [
        "填写并签署 RC-2 续办表格。",
        "准备家庭最近 30 天所有收入的证明。",
        "于 2026 年 11 月 24 日星期二上午 10:30 接听电话面试。",
        "通过网上或邮寄提交表格和收入证明，确保在 2026 年 11 月 30 日前送达。",
        "收入、地址或家庭成员有任何变化时，在变化后 10 天内报告。"
      ]
    }
  };

  /* ---------- 3. Backend team's fixture (api/sample-response.json), unchanged ---------- */
  const artText = `From: Cedar Grove School
Subject: Family Art Night

Return the signed permission slip by May 3, 2027.
Request a printed program by May 8.
Send any corrections within 30 days of receiving this notice.
Family Art Night takes place on May 12, 2027.`;
  const artSpanish = {
    title: "Cedar Grove School invites families to participate in Family Art Night.",
    sender: "Cedar Grove School",
    summary: "Cedar Grove School sent a notice about Family Art Night, detailing deadlines for returning permission slips, requesting printed programs, and sending corrections.",
    deadlines: [
      { action: "Return the signed permission slip", when: "by May 3, 2027", source_quote: "Return the signed permission slip by May 3, 2027.", date: "2027-05-03" },
      { action: "Request a printed program", when: "by May 8", source_quote: "Request a printed program by May 8.", date: null },
      { action: "Send any corrections", when: "within 30 days of receiving this notice", source_quote: "Send any corrections within 30 days of receiving this notice.", date: null }
    ],
    checklist: [
      "Return the signed permission slip by May 3, 2027.",
      "Request a printed program by May 8.",
      "Send any corrections within 30 days of receiving this notice."
    ],
    translated_summary: "La escuela Cedar Grove envió un aviso sobre la Noche de Arte Familiar, detallando los plazos para entregar la autorización firmada, solicitar un programa impreso y enviar correcciones.",
    translated_checklist: [
      "Devuelva la autorización firmada a más tardar el 3 de mayo de 2027.",
      "Solicite un programa impreso a más tardar el 8 de mayo.",
      "Envíe cualquier corrección dentro de los 30 días posteriores a la recepción de este aviso."
    ],
    translated_instructions: "Devuelva la autorización firmada a más tardar el 3 de mayo de 2027.\nSolicite un programa impreso a más tardar el 8 de mayo.\nEnvíe cualquier corrección dentro de los 30 días posteriores a la recepción de este aviso.",
    uncertainties: []
  };

  function build(en, trs) {
    const out = { English: notice(en) };
    Object.keys(trs).forEach(lang => { out[lang] = notice(en, trs[lang]); });
    return out;
  }

  window.PLAINLY_MOCK = {
    samples: {
      school: { fileName: "school-vaccine-notice.txt", text: schoolText, results: build(schoolEn, schoolTr) },
      benefits: { fileName: "food-benefits-renewal.txt", text: benefitsText, results: build(benefitsEn, benefitsTr) },
      artnight: { fileName: "sample-notice.txt", text: artText, results: { Spanish: artSpanish, English: notice(artSpanish) } }
    }
  };
})();
